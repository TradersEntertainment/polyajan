import asyncio
import httpx
import json
import logging
import os
import pytz
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load env variables
load_dotenv()

import database
import backtester

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

GAMMA_API = "https://gamma-api.polymarket.com"

# Symbols we monitor
WATCHLIST = [
    "SPY", "PLTR", "TSLA", "NVDA", "AAPL", "AMZN", "META", "GOOGL",
    "MSFT", "NFLX", "COIN", "HOOD", "ABNB", "RKLB", "EWY", "MU", "WTI", "XAU", "XAG"
]

# Fetch active events from Polymarket Gamma API by slugs
async def fetch_active_polymarket_markets() -> list:
    """Scans and lists active binary Up/Down markets on Polymarket."""
    active_markets = []
    et_tz = pytz.timezone("US/Eastern")
    now_et = datetime.now(et_tz)
    
    month_name = now_et.strftime("%B").lower()
    day = now_et.day
    year = now_et.year

    async def check_symbol(symbol: str):
        ticker = symbol.lower()
        slugs_to_try = [
            (f"{ticker}-up-or-down-on-{month_name}-{day}-{year}", "close"),
            (f"{ticker}-up-or-down-on-{month_name}-{day}-{year}", "close")
        ]
        
        # Open and Close variations
        if symbol == "SPY":
            slugs_to_try.append((f"spx-up-or-down-on-{month_name}-{day}-{year}", "close"))
            slugs_to_try.append((f"spx-opens-up-or-down-on-{month_name}-{day}-{year}", "open"))
            slugs_to_try.append((f"sp-500-opens-up-or-down-on-{month_name}-{day}-{year}", "open"))
        elif symbol == "XAU":
            slugs_to_try.append((f"xauusd-up-or-down-on-{month_name}-{day}-{year}", "close"))
        elif symbol == "XAG":
            slugs_to_try.append((f"xagusd-up-or-down-on-{month_name}-{day}-{year}", "close"))

        async with httpx.AsyncClient() as client:
            for slug, bet_type in slugs_to_try:
                url = f"{GAMMA_API}/events/slug/{slug}"
                try:
                    resp = await client.get(url, timeout=8.0)
                    if resp.status_code != 200:
                        continue
                    event = resp.json()
                    markets = event.get("markets", [])
                    if not markets:
                        continue
                    
                    market = markets[0]
                    outcomes = json.loads(market.get("outcomes", "[]"))
                    prices = json.loads(market.get("outcomePrices", "[]"))
                    
                    if len(outcomes) < 2 or len(prices) < 2:
                        continue

                    up_price = down_price = 0.0
                    up_token_id = down_token_id = None
                    
                    raw_clob_tokens = market.get("clobTokenIds", [])
                    if isinstance(raw_clob_tokens, str):
                        clob_token_ids = json.loads(raw_clob_tokens)
                    else:
                        clob_token_ids = raw_clob_tokens

                    for i, o in enumerate(outcomes):
                        token_id = clob_token_ids[i] if i < len(clob_token_ids) else None
                        if o.lower() in ("up", "yes"):
                            up_price = float(prices[i])
                            up_token_id = token_id
                        elif o.lower() in ("down", "no"):
                            down_price = float(prices[i])
                            down_token_id = token_id

                    active_markets.append({
                        "symbol": symbol,
                        "bet_type": bet_type,
                        "slug": slug,
                        "up_price": up_price,
                        "down_price": down_price,
                        "up_token_id": up_token_id,
                        "down_token_id": down_token_id,
                        "title": event.get("title", slug)
                    })
                except Exception as e:
                    logger.debug(f"Error checking slug {slug}: {e}")

    # Fetch in parallel
    tasks = [check_symbol(s) for s in WATCHLIST]
    await asyncio.gather(*tasks)
    return active_markets

async def call_groq_api(messages: list, model: str = "llama-3.3-70b-versatile") -> str:
    """Helper to send prompt requests to Groq Cloud."""
    if not GROQ_API_KEY:
        logger.error("No GROQ_API_KEY environment variable provided")
        return "{}"
        
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=body, timeout=20.0)
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
            else:
                logger.error(f"Groq API returned error: {resp.status_code} - {resp.text}")
                return "{}"
    except Exception as e:
        logger.error(f"Failed to fetch Groq completions: {e}")
        return "{}"

async def run_parameter_tuning_agent(symbol: str, bet_type: str):
    """
    LLM-in-the-Loop Agent: Analyzes historical parameters and optimizes 
    lookback periods and min yields.
    """
    logger.info(f"AI Agent: Evaluating parameters for {symbol} ({bet_type})")
    
    # 1. Fetch current tuning
    tuning = await database.get_tuning(symbol, bet_type)
    current_lookback = tuning.get("lookback_days", 60)
    current_yield = tuning.get("min_expected_yield", 3.0)
    
    # 2. Fetch history statistics for different lookback variations (30, 60, 90 days)
    variations = {}
    for days in [30, 60, 90]:
        try:
            if bet_type == "open":
                res = await backtester.backtest_open_bet(symbol, "UP", days)
                variations[days] = f"Win Rate (UP): {res['win_rate']:.1f}% (sample: {res['total_days']})"
            else:
                # Mock a mid-day close backtest for volatility reference
                import pyth_client
                pyth_id, _ = pyth_client.get_pyth_id(symbol)
                price = await pyth_client.get_latest_price(pyth_id) if pyth_id else 100.0
                if not price: price = 100.0
                res = await backtester.backtest_close_bet(symbol, price * 1.01, price, "UP", 60, days)
                variations[days] = f"Volatility Reversal Sample Win Rate: {res['win_rate']:.1f}% (sample: {res['total_similar_days']})"
        except Exception as e:
            variations[days] = f"Error: {e}"

    # 3. Call LLM to optimize parameters
    system_prompt = (
        "You are an elite quantitative trading optimizer. Your job is to analyze historical "
        "backtesting samples and determine the optimal parameters for our prediction market scanner.\n\n"
        "Rules:\n"
        "- If lookback days is too small (e.g. 30), it is sensitive to recent trends but lacks sample size.\n"
        "- If lookback days is too large (e.g. 90), it has high sample size but might include outdated regime states.\n"
        "- Minimum expected yield: Choose higher values (e.g. 5% to 8%) for volatile assets (Tesla, Crypto) and lower values (e.g. 2% to 4%) for stable indexes (SPY, Gold).\n\n"
        "You must respond ONLY with a raw JSON object containing these keys:\n"
        "- 'optimized_lookback_days': integer (30, 45, 60, 75 or 90)\n"
        "- 'optimized_min_expected_yield': float (2.0 to 10.0)\n"
        "- 'reasoning': string (brief professional quantitative explanation in Turkish)"
    )

    user_prompt = (
        f"Asset: {symbol}\n"
        f"Bet Type: {bet_type}\n"
        f"Current lookback days: {current_lookback}\n"
        f"Current min yield: {current_yield}%\n"
        f"Backtest Variations:\n"
        f"- 30-day: {variations.get(30)}\n"
        f"- 60-day: {variations.get(60)}\n"
        f"- 90-day: {variations.get(90)}\n\n"
        "Please optimize these settings and output the JSON block."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    response_text = await call_groq_api(messages)
    try:
        decision = json.loads(response_text)
        new_lookback = int(decision.get("optimized_lookback_days", current_lookback))
        new_yield = float(decision.get("optimized_min_expected_yield", current_yield))
        reasoning = decision.get("reasoning", "No explanation provided")

        # 4. Save optimized parameters to DB
        await database.update_tuning(
            symbol=symbol,
            bet_type=bet_type,
            lookback_days=new_lookback,
            minutes_left_threshold=60,
            min_expected_yield=new_yield
        )

        # 5. Log tuning event
        summary = f"Optimized {symbol} {bet_type} -> lookback: {new_lookback}d, min_yield: {new_yield}%"
        await database.add_agent_log(
            log_type="Tuning",
            summary=summary,
            details=f"<b>Tuning Reasoning:</b>\n{reasoning}\n\n<b>Variations analyzed:</b>\n{json.dumps(variations, indent=2)}"
        )
        logger.info(f"AI Agent: {summary}")
    except Exception as e:
        logger.error(f"Failed to process parameter tuning for {symbol}: {e}. Response was: {response_text}")

async def run_portfolio_risk_agent():
    """
    LLM chief risk officer agent that reviews the virtual portfolio's recent performance
    and adapts the global risk profile (CONSERVATIVE, MODERATE, AGGRESSIVE).
    """
    logger.info("AI Agent: Evaluating portfolio performance for risk adjustment...")
    
    try:
        portfolio = await database.get_portfolio()
        balance = portfolio["balance"]
        equity = portfolio["equity"]
        current_risk_profile = portfolio["risk_profile"]
        
        perf = await database.get_recent_performance(limit=10)
        win_rate = perf["win_rate"]
        total_profit = perf["total_profit"]
        total_trades = perf["total_trades"]
        
        system_prompt = (
            "You are the Chief Risk Officer (CRO) of an elite quantitative hedge fund. "
            "Your job is to analyze our virtual paper trading performance and determine the optimal global risk profile "
            "for our trading scanner.\n\n"
            "Risk Profiles:\n"
            "- 'CONSERVATIVE': Minimizes drawdown. Restricts trades to extremely high edge (>=15%), reduces size. Use when the win rate is low (<60%) or we have significant net losses.\n"
            "- 'MODERATE': Default state. Balanced edge search (>=12%) and default size. Use when performance is stable and win rate is between 60% and 75%.\n"
            "- 'AGGRESSIVE': Maximizes yield. Lowers required edge (>=8%) to take more trades and increases trade size. Use when win rate is very high (>75%) and net profit is growing.\n\n"
            "You must respond ONLY with a raw JSON object containing these keys:\n"
            "- 'risk_profile': string ('CONSERVATIVE', 'MODERATE', or 'AGGRESSIVE')\n"
            "- 'justification': string (brief professional quantitative explanation in Turkish explaining your choice based on our balance and win rate)"
        )
        
        user_prompt = (
            f"Virtual Portfolio Balance: ${balance:.2f}\n"
            f"Portfolio Equity (with open positions): ${equity:.2f}\n"
            f"Net Profit of Recent Trades: ${total_profit:+.2f}\n"
            f"Win Rate (Last {total_trades} trades): {win_rate:.1f}%\n"
            f"Active Risk Profile: {current_risk_profile}\n\n"
            "Please evaluate these metrics and output the JSON block."
        )
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        response_text = await call_groq_api(messages)
        decision = json.loads(response_text)
        new_risk = decision.get("risk_profile", current_risk_profile).upper()
        justification = decision.get("justification", "No explanation provided")
        
        if new_risk not in ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]:
            new_risk = "MODERATE"
            
        await database.update_risk_profile(new_risk, justification)
        
        summary = f"Hedge Fund Risk Profile Adjusted: -> {new_risk}"
        await database.add_agent_log(
            "Tuning",
            summary,
            f"<b>Risk Tuning Decision:</b>\n{justification}\n\n"
            f"<b>Stats Reviewed:</b>\n"
            f"- Balance: ${balance:.2f}\n"
            f"- Equity: ${equity:.2f}\n"
            f"- Win Rate: {win_rate:.1f}% (sample: {total_trades})\n"
            f"- Profit: ${total_profit:+.2f}"
        )
        logger.info(f"AI Agent: {summary}")
        
    except Exception as e:
        logger.error(f"Failed to run portfolio risk agent: {e}")

async def resolve_virtual_trades():
    """Checks open virtual trades and resolves them using Pyth pricing."""
    logger.info("AI Agent: Checking open virtual trades for resolution...")
    open_trades = await database.get_open_virtual_trades()
    if not open_trades:
        return
        
    import pyth_client
    et_tz = pytz.timezone("US/Eastern")
    now_et = datetime.now(et_tz)
    
    resolved_any = False
    for t in open_trades:
        trade_id = t["id"]
        symbol = t["symbol"]
        direction = t["direction"]
        ref_price = t["ref_price"]
        entry_price = t["entry_price"]
        created_at_str = t["created_at"]
        
        try:
            created_dt = datetime.fromisoformat(created_at_str)
            if created_dt.tzinfo is None:
                created_dt = pytz.utc.localize(created_dt).astimezone(et_tz)
            else:
                created_dt = created_dt.astimezone(et_tz)
        except Exception:
            created_dt = now_et - timedelta(hours=2)
            
        is_open_bet = direction.startswith("OPEN_")
        
        # Target resolution calculation
        if is_open_bet:
            creation_cutoff = et_tz.localize(datetime(created_dt.year, created_dt.month, created_dt.day, 9, 30, 0))
            if created_dt < creation_cutoff:
                res_date = created_dt.date()
            else:
                res_date = created_dt.date() + timedelta(days=1)
                while res_date.weekday() >= 5 or not pyth_client.is_cme_business_day(res_date):
                    res_date += timedelta(days=1)
                    
            target_res_dt = et_tz.localize(datetime(res_date.year, res_date.month, res_date.day, 9, 30, 5))
            
            if now_et >= target_res_dt:
                start_ts = int(et_tz.localize(datetime(res_date.year, res_date.month, res_date.day, 9, 30, 0)).timestamp())
                end_ts = int(et_tz.localize(datetime(res_date.year, res_date.month, res_date.day, 9, 30, 59)).timestamp())
                
                pyth_id, full_symbol = pyth_client.get_pyth_id(symbol)
                if not pyth_id:
                    continue
                    
                open_price = await pyth_client.get_historical_candle_price(
                    full_symbol, pyth_id, start_ts, end_ts, price_type='open'
                )
                
                if open_price is None:
                    continue
                    
                opened_up = open_price > ref_price
                win_dir = "OPEN_UP" if opened_up else "OPEN_DOWN"
                
                is_win = direction == win_dir
                status = "won" if is_win else "lost"
                payout = 1.0 if is_win else 0.0
                
                await database.resolve_virtual_trade(trade_id, status, payout)
                
                summary = f"Sanal Islem Cozuldu: {symbol} {direction} -> {status.upper()} (Acilis: ${open_price:.2f} vs Ref: ${ref_price:.2f})"
                await database.add_agent_log(
                    "Decision", 
                    summary, 
                    f"Acilis fiyati: ${open_price:.2f}. Referans fiyati: ${ref_price:.2f}. Kazanan Yon: {win_dir}."
                )
                logger.info(f"AI Agent: {summary}")
                
        else: # Close bet
            is_commodity = any(c in symbol for c in ["WTI", "XAU", "XAG", "GOLD", "SILVER"])
            close_hour = 17 if is_commodity else 16
            
            creation_cutoff = et_tz.localize(datetime(created_dt.year, created_dt.month, created_dt.day, close_hour, 0, 0))
            if created_dt < creation_cutoff:
                res_date = created_dt.date()
            else:
                res_date = created_dt.date() + timedelta(days=1)
                while res_date.weekday() >= 5 or not pyth_client.is_cme_business_day(res_date):
                    res_date += timedelta(days=1)
                    
            target_res_dt = et_tz.localize(datetime(res_date.year, res_date.month, res_date.day, close_hour, 0, 5))
            
            if now_et >= target_res_dt:
                start_ts = int(et_tz.localize(datetime(res_date.year, res_date.month, res_date.day, close_hour - 1, 59, 0)).timestamp())
                end_ts = int(et_tz.localize(datetime(res_date.year, res_date.month, res_date.day, close_hour - 1, 59, 59)).timestamp())
                
                pyth_id, full_symbol = pyth_client.get_pyth_id(symbol)
                if not pyth_id:
                    continue
                    
                close_price = await pyth_client.get_historical_candle_price(
                    full_symbol, pyth_id, start_ts, end_ts, price_type='close'
                )
                
                if close_price is None:
                    continue
                    
                closed_up = close_price > ref_price
                win_dir = "UP" if closed_up else "DOWN"
                
                is_win = direction == win_dir
                status = "won" if is_win else "lost"
                payout = 1.0 if is_win else 0.0
                
                await database.resolve_virtual_trade(trade_id, status, payout)
                resolved_any = True
                
                summary = f"Sanal Islem Cozuldu: {symbol} {direction} -> {status.upper()} (Kapanis: ${close_price:.2f} vs Ref: ${ref_price:.2f})"
                await database.add_agent_log(
                    "Decision", 
                    summary, 
                    f"Kapanis fiyati: ${close_price:.2f}. Referans fiyati: ${ref_price:.2f}. Kazanan Yon: {win_dir}."
                )
                logger.info(f"AI Agent: {summary}")
                
    if resolved_any:
        await database.record_portfolio_history()

async def run_autonomous_scan_cycle():
    """Main scanning cycle to compare Polymarket prices vs historical Quant win-rates."""
    logger.info("AI Agent: Starting scanning cycle...")
    
    # 1. Resolve open trades
    await resolve_virtual_trades()
    
    # 2. Archive active signals
    await database.archive_all_signals()
 
    # 3. Get global risk profile and determine trading mode / limits
    risk_profile = await database.get_risk_profile()
    trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
    portfolio = await database.get_portfolio()
    total_capital = portfolio["equity"]

    if trading_mode == "REAL":
        # Dynamic sizing/thresholds for Real account ($100 budget)
        # Strict user constraint: en kötü garanti %1 bulsun
        required_edge_threshold = 0.01
        trade_size_usd = max(2.0, total_capital * 0.10) # default baseline size, but sequentially managed
        
        # Enforce minimum win probability for real funds to avoid low-prob lottery bets
        if risk_profile == "CONSERVATIVE":
            min_win_prob = 0.70
        elif risk_profile == "AGGRESSIVE":
            min_win_prob = 0.55
        else: # MODERATE
            min_win_prob = 0.60
    else:
        # Standard sizing for Virtual account ($1000 budget)
        if risk_profile == "CONSERVATIVE":
            required_edge_threshold = 0.15
            trade_size_usd = 50.0
            min_win_prob = 0.65
        elif risk_profile == "AGGRESSIVE":
            required_edge_threshold = 0.08
            trade_size_usd = 150.0
            min_win_prob = 0.50
        else: # MODERATE
            required_edge_threshold = 0.12
            trade_size_usd = 100.0
            min_win_prob = 0.55
 
    # 4. Fetch active Polymarket markets
    markets = await fetch_active_polymarket_markets()
    if not markets:
        logger.info("AI Agent: No active Polymarket markets found in this window.")
        return
 
    import pyth_client
    et_tz = pytz.timezone("US/Eastern")
    now_et = datetime.now(et_tz)
    total_minutes = now_et.hour * 60 + now_et.minute
    
    trade_candidates = []
 
    for m in markets:
        symbol = m["symbol"]
        bet_type = m["bet_type"]
        slug = m["slug"]
        up_price = m["up_price"]
        down_price = m["down_price"]
        
        # Get active parameter tuning from DB
        tuning = await database.get_tuning(symbol, bet_type)
        lookback = tuning["lookback_days"]
        min_yield = tuning["min_expected_yield"]
 
        pyth_id, _ = pyth_client.get_pyth_id(symbol)
        if not pyth_id:
            continue
 
        current_price = await pyth_client.get_active_price(symbol, pyth_id)
        if not current_price:
            continue
 
        # Get yesterday's close reference
        from_ts, to_ts = pyth_client.get_previous_close_times(symbol)
        ref_price = await pyth_client.get_historical_candle_price(
            pyth_client.SYMBOL_MAP.get(symbol) or symbol, pyth_id, from_ts, to_ts, price_type='close'
        )
        if not ref_price:
            continue
 
        close_minutes = 1020 if any(c in symbol for c in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]) else 960
        minutes_to_close = max(0, close_minutes - total_minutes)
 
        # Perform backtests for both UP and DOWN outcomes
        for direction in ["UP", "DOWN"]:
            poly_prob = up_price if direction == "UP" else down_price
            if poly_prob <= 0.01:
                continue
 
            if bet_type == "open":
                res = await backtester.backtest_open_bet(symbol, direction, lookback)
            else:
                res = await backtester.backtest_close_bet(symbol, current_price, ref_price, direction, minutes_to_close, lookback)
 
            quant_prob = res["win_rate"] / 100.0
            edge = quant_prob - poly_prob
            
            # Expected yield on Polymarket: (1 - purchase_price) / purchase_price * 100
            expected_yield = ((1.0 - poly_prob) / poly_prob * 100) if poly_prob > 0 else 0.0
 
            # Filter: We look for opportunities where:
            # - Real quant probability of winning is high (e.g. >= 85%) AND expected yield meets the minimum yield
            # - OR there is a significant pricing edge (e.g. real probability is X% higher than Polymarket price)
            # - AND the absolute win probability is at least min_win_prob to avoid low-probability lottery bets
            is_significant_edge = (edge >= required_edge_threshold) and (quant_prob >= min_win_prob)
            is_high_prob_yield = (quant_prob >= 0.88) and (expected_yield >= min_yield)
            
            if is_significant_edge or is_high_prob_yield:
                # Determine confidence rating
                if quant_prob >= 0.97:
                    stars, level = "⭐⭐⭐⭐⭐", "ÇOK GÜVENLİ"
                elif quant_prob >= 0.93:
                    stars, level = "⭐⭐⭐⭐", "GÜVENLİ"
                elif quant_prob >= 0.88:
                    stars, level = "⭐⭐⭐", "ORTA RİSKLİ"
                else:
                    stars, level = "⭐⭐", "SPEKÜLATİF"
 
                # Log signal into database
                diff_pct = ((current_price - ref_price) / ref_price) * 100
                await database.add_signal(
                    symbol=symbol,
                    direction=f"OPEN_{direction}" if bet_type == "open" else direction,
                    ref_price=ref_price,
                    current_price=current_price,
                    diff_pct=diff_pct,
                    polymarket_slug=slug,
                    polymarket_price=poly_prob,
                    quant_probability=quant_prob,
                    edge_pct=edge,
                    confidence_level=level,
                    confidence_stars=stars
                )
                logger.info(f"AI Agent Signal: {symbol} {direction} | Poly: {poly_prob:.2f} vs Quant: {quant_prob:.2f} (Edge: {edge:+.2f})")
 
                # Gather trade candidates for processing
                token_id = m["up_token_id"] if direction == "UP" else m["down_token_id"]
                trade_dir = f"OPEN_{direction}" if bet_type == "open" else direction
                
                trade_candidates.append({
                    "symbol": symbol,
                    "direction": trade_dir,
                    "ref_price": ref_price,
                    "entry_price": poly_prob,
                    "edge": edge,
                    "slug": slug,
                    "token_id": token_id
                })
                
    # 5. Execute trades from highest edge to lowest edge to maximize capital usage
    trade_candidates.sort(key=lambda x: x["edge"], reverse=True)
    
    # Filter candidates to only those we don't already have open positions in
    open_trades = await database.get_open_virtual_trades()
    active_positions = {(t["symbol"], t["direction"]) for t in open_trades}
    new_candidates = [c for c in trade_candidates if (c["symbol"], c["direction"]) not in active_positions]
    
    if new_candidates:
        # Get current portfolio values dynamically
        port = await database.get_portfolio()
        balance = port["balance"]
        equity = port["equity"]
        
        if trading_mode == "REAL":
            # Determine total budget to allocate to leave at most 5% idle cash
            target_cash = equity * 0.05
            budget_to_allocate = balance - target_cash
            
            # Minimum CLOB trade size is $2.0
            if budget_to_allocate >= 2.0:
                remaining_budget = budget_to_allocate
                for idx, cand in enumerate(new_candidates):
                    if remaining_budget < 2.0:
                        break
                    
                    is_last = (idx == len(new_candidates) - 1)
                    if is_last:
                        size_to_trade = remaining_budget
                    else:
                        share = remaining_budget / (len(new_candidates) - idx)
                        size_to_trade = max(2.0, share)
                        if size_to_trade > remaining_budget:
                            size_to_trade = remaining_budget
                            
                    if size_to_trade >= 2.0:
                        success = await database.open_virtual_trade(
                            symbol=cand["symbol"],
                            direction=cand["direction"],
                            ref_price=cand["ref_price"],
                            entry_price=cand["entry_price"],
                            size_usd=size_to_trade,
                            polymarket_slug=cand["slug"],
                            clob_token_id=cand["token_id"]
                        )
                        if success:
                            remaining_budget -= size_to_trade
                            shares = size_to_trade / cand["entry_price"]
                            await database.add_agent_log(
                                "Decision",
                                f"Gerçek İşlem Açıldı: {cand['symbol']} {cand['direction']}",
                                f"Pozisyon açıldı: {shares:.2f} adet hisse ${cand['entry_price']:.2f} fiyattan satın alındı (Toplam: ${size_to_trade:.2f}).\n"
                                f"Risk Profili: {risk_profile}. Referans Fiyat: ${cand['ref_price']:.2f}."
                            )
                            logger.info(f"AI Agent: Real trade opened: {cand['symbol']} {cand['direction']} (Size: ${size_to_trade:.2f})")
        else:
            # Virtual trading mode logic (uses standard trade_size_usd per trade, but caps at remaining balance)
            for cand in new_candidates:
                port = await database.get_portfolio()
                balance = port["balance"]
                
                size_to_trade = trade_size_usd
                if balance < size_to_trade:
                    if balance >= 2.0:
                        size_to_trade = balance
                    else:
                        continue
                        
                success = await database.open_virtual_trade(
                    symbol=cand["symbol"],
                    direction=cand["direction"],
                    ref_price=cand["ref_price"],
                    entry_price=cand["entry_price"],
                    size_usd=size_to_trade,
                    polymarket_slug=cand["slug"],
                    clob_token_id=cand["token_id"]
                )
                if success:
                    shares = size_to_trade / cand["entry_price"]
                    await database.add_agent_log(
                        "Decision",
                        f"Sanal İşlem Açıldı: {cand['symbol']} {cand['direction']}",
                        f"Sanal pozisyon açıldı: {shares:.2f} adet hisse ${cand['entry_price']:.2f} fiyattan satın alındı (Toplam: ${size_to_trade:.2f}).\n"
                        f"Risk Profili: {risk_profile}. Referans Fiyat: ${cand['ref_price']:.2f}."
                    )
                    logger.info(f"AI Agent: Virtual trade opened: {cand['symbol']} {cand['direction']} (Size: ${size_to_trade:.2f})")
                        
    # Record portfolio value after scan cycle completes
    await database.record_portfolio_history()

async def agent_scheduler_loop():
    """Background task runner for the AI Agent."""
    logger.info("Starting AI Quant Agent Loop...")
    await database.init_db()

    # Wait for pyth feed cache to initialize in main application
    await asyncio.sleep(10)
    
    while True:
        try:
            # 1. Run signal scan loop immediately to resolve open trades and find new signals
            await run_autonomous_scan_cycle()
            
            # 2. Run portfolio-wide risk profile assessment
            await run_portfolio_risk_agent()
            await asyncio.sleep(2.0)
            
            # 3. Run parameter tuning loop for all assets (once every 4 hours)
            # Run sequentially to respect API rate limits
            for symbol in WATCHLIST:
                for bt in ["open", "close"]:
                    await run_parameter_tuning_agent(symbol, bt)
                    await asyncio.sleep(2.0) # rate-limiting cushion
            
            # 4. Continue running scan loop for the rest of the 4 hours
            # Run scan 47 more times (approx 4 hours)
            for _ in range(47):
                await asyncio.sleep(300)
                await run_autonomous_scan_cycle()

        except Exception as e:
            logger.error(f"Error in agent scheduler: {e}")
            await asyncio.sleep(60)

def start_agent_task():
    """Start the AI Agent background thread."""
    asyncio.create_task(agent_scheduler_loop())
