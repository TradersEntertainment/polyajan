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

_position_sync_lock = asyncio.Lock()
_active_markets_cache = None
_active_markets_cache_time = 0.0

import database
import backtester

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

async def send_telegram_message(message: str):
    if not TELEGRAM_TOKEN or not CHAT_ID:
        logger.warning("Telegram notification skipped: TELEGRAM_TOKEN or CHAT_ID not configured.")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {
        "chat_id": CHAT_ID,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=8.0)
            if resp.status_code != 200:
                logger.error(f"Failed to send Telegram message: status {resp.status_code}, response: {resp.text}")
    except Exception as e:
        logger.error(f"Error sending Telegram notification: {e}")

GAMMA_API = "https://gamma-api.polymarket.com"

# Symbols we monitor
WATCHLIST = [
    "SPY", "PLTR", "TSLA", "NVDA", "AAPL", "AMZN", "META", "GOOGL",
    "MSFT", "NFLX", "COIN", "HOOD", "ABNB", "RKLB", "EWY", "MU", "WTI", "XAU", "XAG"
]

# Fetch active events from Polymarket Gamma API by slugs
def parse_market_question(question: str) -> tuple:
    q = question.upper()
    
    # Identify Asset
    matched_symbol = None
    for sym in WATCHLIST:
        if sym in q:
            matched_symbol = sym
            break
            
    if not matched_symbol:
        fuzzy_map = {
            "PALANTIR": "PLTR",
            "TESLA": "TSLA",
            "NVIDIA": "NVDA",
            "APPLE": "AAPL",
            "AMAZON": "AMZN",
            "GOOGLE": "GOOGL",
            "ALPHABET": "GOOGL",
            "MICROSOFT": "MSFT",
            "NETFLIX": "NFLX",
            "COINBASE": "COIN",
            "ROBINHOOD": "HOOD",
            "AIRBNB": "ABNB",
            "ROCKET LAB": "RKLB",
            "MICRON": "MU",
            "CRUDE OIL": "WTI",
            "GOLD": "XAU",
            "SILVER": "XAG",
            "S&P 500": "SPY",
            "SPX": "SPY"
        }
        for name, sym in fuzzy_map.items():
            if name in q:
                matched_symbol = sym
                break
                
    if not matched_symbol:
        return None, None, None
        
    # Extract Strike Price
    import re
    match = re.search(r'(?:above|below|exceed|touch|hit)\s*(?:\([A-Z]+\)\s*)?\$?([0-9,.]+)', question, re.IGNORECASE)
    if not match:
        return None, None, None
        
    try:
        strike_price = float(match.group(1).replace(",", ""))
    except ValueError:
        return None, None, None
        
    # Determine type
    m_type = None
    if "above" in question.lower() or "exceed" in question.lower():
        m_type = "above"
    elif "below" in question.lower():
        m_type = "below"
        
    if not m_type:
        return None, None, None
        
    return matched_symbol, strike_price, m_type

async def auto_detect_clob_positions():
    """
    Auto-detects open positions on Polymarket CLOB by checking token balances 
    of the active markets, and syncs them to the database.
    """
    async with _position_sync_lock:
        private_key = os.getenv("POLYMARKET_PRIVATE_KEY")
        wallet_address = os.getenv("POLYMARKET_WALLET_ADDRESS")
        sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "1"))
        
        if not private_key or not wallet_address:
            logger.info("Auto-detect skipped: POLYMARKET_PRIVATE_KEY or POLYMARKET_WALLET_ADDRESS not configured.")
            return
            
        try:
            from py_clob_client_v2.client import ClobClient
            from py_clob_client_v2 import BalanceAllowanceParams, AssetType
            
            # Initialize client with POLY_1271 patch support
            # Monkey patch L1 headers POLY_ADDRESS dynamically
            import py_clob_client_v2.headers.headers as sdk_headers
            original_create_level_1_headers = sdk_headers.create_level_1_headers
            
            def patched_create_level_1_headers(signer, timestamp, nonce=0, custom_address=None):
                headers = original_create_level_1_headers(signer, timestamp, nonce)
                headers["POLY_ADDRESS"] = wallet_address
                return headers
                
            sdk_headers.create_level_1_headers = patched_create_level_1_headers
            
            client = ClobClient(
                host="https://clob.polymarket.com",
                key=private_key,
                chain_id=137,
                signature_type=sig_type,
                funder=wallet_address
            )
            api_key = os.getenv("POLYMARKET_API_KEY")
            api_secret = os.getenv("POLYMARKET_API_SECRET")
            api_passphrase = os.getenv("POLYMARKET_API_PASSPHRASE")
            
            if not (api_key and api_secret and api_passphrase):
                client.set_api_creds(client.create_or_derive_api_key())
            else:
                from py_clob_client_v2 import ApiCreds
                creds = ApiCreds(api_key=api_key, secret=api_secret, passphrase=api_passphrase)
                client.set_api_creds(creds)
                
            # Get active markets
            active_markets = await fetch_active_polymarket_markets()
            if not active_markets:
                logger.info("Auto-detect: No active markets found to check balances.")
                return
                
            # Get already tracked open real trades
            pool = await database.get_pool()
            async with pool.acquire() as conn:
                # 1. Tracked tokens to check for external close
                rows_open = await conn.fetch("SELECT id, clob_token_id, size_usd, shares, entry_price, symbol FROM virtual_trades WHERE status = 'open' AND trade_type = 'real'")
                tracked_tokens = {r["clob_token_id"] for r in rows_open if r["clob_token_id"]}
                
                # 2. Untracked candidate tokens to check for import
                candidate_tokens = []
                for m in active_markets:
                    for token_field, direction in [("up_token_id", "UP"), ("down_token_id", "DOWN")]:
                        tok_id = m.get(token_field)
                        if tok_id and tok_id not in tracked_tokens:
                            # Append metadata to reconstruct the trade later if found
                            candidate_tokens.append({
                                "token_id": tok_id,
                                "symbol": m["symbol"],
                                "direction": f"OPEN_{direction}" if m["bet_type"] == "open" else direction,
                                "slug": m["slug"],
                                "title": m["title"],
                                "price": m["up_price"] if direction == "UP" else m["down_price"],
                                "ref_price": m.get("strike_price") or 755.0  # fallback reference price
                            })
                
                # All tokens to check
                tokens_to_check = []
                # Format: (token_id, is_new, extra_data)
                for cand in candidate_tokens:
                    tokens_to_check.append((cand["token_id"], True, cand))
                for r in rows_open:
                    if r["clob_token_id"]:
                        tokens_to_check.append((r["clob_token_id"], False, dict(r)))
                
                if not tokens_to_check:
                    logger.info("Auto-detect: No tracked or untracked tokens to check.")
                    return
                    
                logger.info(f"Auto-detect: Querying CLOB balances for {len(tokens_to_check)} tokens...")
                
                # Query balances in parallel
                async def get_balance(tok_id, is_new, extra_data):
                    try:
                        # Run client.get_balance_allowance in threadpool as it is synchronous in the SDK
                        loop = asyncio.get_event_loop()
                        params = BalanceAllowanceParams(asset_type=AssetType.CONDITIONAL, token_id=tok_id)
                        res = await loop.run_in_executor(None, client.get_balance_allowance, params)
                        
                        bal = 0.0
                        if isinstance(res, dict):
                            bal = float(res.get("balance", 0.0))
                        else:
                            bal = float(getattr(res, "balance", 0.0))
                        
                        # Divide by 1,000,000 to convert raw contract balance to shares
                        bal = bal / 1000000.0
                        return tok_id, is_new, extra_data, bal
                    except Exception as ex:
                        logger.error(f"Error fetching balance for token {tok_id}: {ex}")
                        return tok_id, is_new, extra_data, None
                
                results = await asyncio.gather(*(get_balance(t_id, is_n, data) for t_id, is_n, data in tokens_to_check))
                
                now_str = datetime.now().isoformat()
                
                for tok_id, is_new, extra_data, bal in results:
                    if bal is None:
                        continue
                        
                    if is_new:
                        # Sync logic for new positions
                        if bal >= 0.1:  # user holds at least 0.1 shares
                            # Check again to avoid duplicate insertion due to races
                            exists = await conn.fetchval(
                                "SELECT COUNT(*) FROM virtual_trades WHERE status = 'open' AND clob_token_id = $1", 
                                tok_id
                            )
                            if not exists:
                                # Reconstruct entry price and size
                                entry_price = extra_data["price"] if extra_data["price"] > 0 else 0.50
                                
                                # Dynamically fetch reference price if possible
                                ref_price = extra_data["ref_price"]
                                try:
                                    import pyth_client
                                    pyth_id, full_symbol = pyth_client.get_pyth_id(extra_data["symbol"])
                                    if pyth_id:
                                        from_ts, to_ts = pyth_client.get_previous_close_times(extra_data["symbol"])
                                        ref_price_fetched = await pyth_client.get_historical_candle_price(
                                            full_symbol or extra_data["symbol"], pyth_id, from_ts, to_ts, price_type='close'
                                        )
                                        if ref_price_fetched:
                                            ref_price = ref_price_fetched
                                except Exception:
                                    pass
                                    
                                size_usd = bal * entry_price
                                
                                # Insert into database as open real trade
                                await conn.execute("""
                                    INSERT INTO virtual_trades (symbol, direction, ref_price, entry_price, size_usd, shares, status, created_at, polymarket_slug, clob_token_id, trade_type)
                                    VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, 'real')
                                """, extra_data["symbol"], extra_data["direction"], ref_price, entry_price, size_usd, bal, now_str, extra_data["slug"], tok_id)
                                
                                logger.info(f"Auto-imported real position: {extra_data['symbol']} {extra_data['direction']} | {bal:.2f} shares")
                                
                                # Send Telegram notification
                                try:
                                    msg = (
                                        f"📥 <b>[GERÇEK POZİSYON İÇE AKTARILDI]</b>\n\n"
                                        f"Cüzdanda açık olan Polymarket pozisyonu tespit edildi ve sisteme aktarıldı:\n\n"
                                        f"• <b>Enstrüman:</b> {extra_data['symbol']}\n"
                                        f"• <b>Yön:</b> {extra_data['direction']}\n"
                                        f"• <b>Adet:</b> {bal:.2f} Pay\n"
                                        f"• <b>Tahmini Değer:</b> ${size_usd:.2f}\n"
                                        f"• <b>Piyasa:</b> {extra_data['title']}"
                                    )
                                    await send_telegram_message(msg)
                                except Exception:
                                    pass
                    else:
                        # Close or partial close logic for tracked positions that have been closed/sold/bought externally
                        db_shares = extra_data["shares"]
                        
                        if bal < 0.1:
                            # Fully closed
                            # Check current best bid price to calculate simulated PnL
                            sell_price = extra_data["entry_price"]
                            try:
                                url_book = f"https://clob.polymarket.com/book?token_id={tok_id}"
                                async with httpx.AsyncClient() as hc:
                                    resp_book = await hc.get(url_book, timeout=4.0)
                                    if resp_book.status_code == 200:
                                        book_data = resp_book.json()
                                        bids = book_data.get("bids", [])
                                        if bids:
                                            bids_sorted = sorted(bids, key=lambda x: float(x.get("price", 0)), reverse=True)
                                            sell_price = float(bids_sorted[0]["price"])
                            except Exception:
                                pass
                                
                            proceeds = db_shares * sell_price
                            profit = proceeds - extra_data["size_usd"]
                            status = "won" if profit >= 0 else "lost"
                            
                            await conn.execute("""
                                UPDATE virtual_trades 
                                SET status = $1, profit = $2, resolved_at = $3
                                WHERE id = $4
                            """, status, profit, now_str, extra_data["id"])
                            
                            logger.info(f"Auto-resolved closed position: {extra_data['symbol']} | {db_shares:.2f} shares at ${sell_price:.2f}")
                            
                            # Send Telegram notification
                            try:
                                msg = (
                                    f"🏁 <b>[GERÇEK POZİSYON KAPANDI]</b>\n\n"
                                    f"Polymarket üzerinde pozisyonun kapandığı tespit edildi. Veritabanı güncellendi:\n\n"
                                    f"• <b>Enstrüman:</b> {extra_data['symbol']}\n"
                                    f"• <b>Adet:</b> {db_shares:.2f} Pay\n"
                                    f"• <b>Satış Fiyatı (Tahmini):</b> ${sell_price:.2f}\n"
                                    f"• <b>Kâr/Zarar:</b> <b>${profit:+.2f}</b>"
                                )
                                await send_telegram_message(msg)
                            except Exception:
                                pass
                        elif bal < db_shares - 0.5:
                            # Partial sell detected
                            sold_shares = db_shares - bal
                            
                            # Fetch current best bid price to calculate simulated PnL
                            sell_price = extra_data["entry_price"]
                            try:
                                url_book = f"https://clob.polymarket.com/book?token_id={tok_id}"
                                async with httpx.AsyncClient() as hc:
                                    resp_book = await hc.get(url_book, timeout=4.0)
                                    if resp_book.status_code == 200:
                                        book_data = resp_book.json()
                                        bids = book_data.get("bids", [])
                                        if bids:
                                            bids_sorted = sorted(bids, key=lambda x: float(x.get("price", 0)), reverse=True)
                                            sell_price = float(bids_sorted[0]["price"])
                            except Exception:
                                pass
                                
                            proceeds = sold_shares * sell_price
                            ratio = sold_shares / db_shares
                            closed_size = extra_data["size_usd"] * ratio
                            profit = proceeds - closed_size
                            
                            new_size = extra_data["size_usd"] - closed_size
                            await conn.execute("""
                                UPDATE virtual_trades 
                                SET shares = $1, size_usd = $2 
                                WHERE id = $3
                            """, bal, new_size, extra_data["id"])
                            
                            logger.info(f"Auto-detected partial sell: {extra_data['symbol']} | sold {sold_shares:.2f} shares, remaining {bal:.2f} shares")
                            
                            # Send Telegram notification
                            try:
                                msg = (
                                    f"📉 <b>[KISMİ GERÇEK POZİSYON SATIŞI]</b>\n\n"
                                    f"Polymarket üzerinde kısmi satış tespit edildi. Veritabanı güncellendi:\n\n"
                                    f"• <b>Enstrüman:</b> {extra_data['symbol']}\n"
                                    f"• <b>Satılan Miktar:</b> {sold_shares:.2f} Pay\n"
                                    f"• <b>Kalan Miktar:</b> {bal:.2f} Pay\n"
                                    f"• <b>Satış Fiyatı (Tahmini):</b> ${sell_price:.2f}\n"
                                    f"• <b>Kâr/Zarar (Kısmi):</b> <b>${profit:+.2f}</b>"
                                )
                                await send_telegram_message(msg)
                            except Exception:
                                pass
                        elif bal > db_shares + 0.5:
                            # Additional buy detected
                            bought_shares = bal - db_shares
                            
                            # Fetch current best ask price to calculate cost
                            buy_price = extra_data["entry_price"]
                            try:
                                url_book = f"https://clob.polymarket.com/book?token_id={tok_id}"
                                async with httpx.AsyncClient() as hc:
                                    resp_book = await hc.get(url_book, timeout=4.0)
                                    if resp_book.status_code == 200:
                                        book_data = resp_book.json()
                                        asks = book_data.get("asks", [])
                                        if asks:
                                            asks_sorted = sorted(asks, key=lambda x: float(x.get("price", 0)))
                                            buy_price = float(asks_sorted[0]["price"])
                            except Exception:
                                pass
                                
                            cost = bought_shares * buy_price
                            new_size = extra_data["size_usd"] + cost
                            new_entry_price = new_size / bal if bal > 0 else buy_price
                            
                            await conn.execute("""
                                UPDATE virtual_trades 
                                SET shares = $1, size_usd = $2, entry_price = $3 
                                WHERE id = $4
                            """, bal, new_size, new_entry_price, extra_data["id"])
                            
                            logger.info(f"Auto-detected additional purchase: {extra_data['symbol']} | bought {bought_shares:.2f} shares, new total {bal:.2f} shares")
                            
                            # Send Telegram notification
                            try:
                                msg = (
                                    f"📈 <b>[EK GERÇEK POZİSYON ALIMI]</b>\n\n"
                                    f"Polymarket üzerinde ek alım tespit edildi. Veritabanı güncellendi:\n\n"
                                    f"• <b>Enstrüman:</b> {extra_data['symbol']}\n"
                                    f"• <b>Alınan Miktar:</b> {bought_shares:.2f} Pay\n"
                                    f"• <b>Yeni Toplam:</b> {bal:.2f} Pay\n"
                                    f"• <b>Alış Fiyatı (Tahmini):</b> ${buy_price:.2f}\n"
                                    f"• <b>Maliyet:</b> ${cost:.2f}\n"
                                    f"• <b>Yeni Ort. Giriş:</b> ${new_entry_price:.2f}"
                                )
                                await send_telegram_message(msg)
                            except Exception:
                                pass
        except Exception as e:
            logger.error(f"Error in auto_detect_clob_positions: {e}")

async def fetch_active_polymarket_markets() -> list:
    """Scans and lists active binary Up/Down and closes-above/below strike markets on Polymarket."""
    global _active_markets_cache, _active_markets_cache_time
    now = time.time()
    if _active_markets_cache is not None and (now - _active_markets_cache_time) < 300:
        logger.debug("Returning cached active markets.")
        return _active_markets_cache

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

    # Dynamic closes-above / closes-below search
    queries = ["closes above", "closes below"]
    seen_market_ids = set()
    
    async with httpx.AsyncClient() as client:
        for q in queries:
            url = f"{GAMMA_API}/public-search"
            params = {
                "q": q,
                "active": "true",
                "closed": "false",
                "limit": 60
            }
            try:
                resp = await client.get(url, params=params, timeout=10.0)
                if resp.status_code == 200:
                    data = resp.json()
                    events = data.get("events", [])
                    for ev in events:
                        markets = ev.get("markets", [])
                        for m in markets:
                            m_id = m.get("id")
                            if m_id and m_id not in seen_market_ids:
                                if m.get("active") and not m.get("closed"):
                                    seen_market_ids.add(m_id)
                                    
                                    question = m.get("question", "")
                                    symbol, strike_price, m_type = parse_market_question(question)
                                    if symbol:
                                        outcomes = json.loads(m.get("outcomes", "[]"))
                                        prices = json.loads(m.get("outcomePrices", "[]"))
                                        raw_tokens = m.get("clobTokenIds", [])
                                        if isinstance(raw_tokens, str):
                                            clob_token_ids = json.loads(raw_tokens)
                                        else:
                                            clob_token_ids = raw_tokens
                                            
                                        if len(outcomes) >= 2 and len(prices) >= 2 and len(clob_token_ids) >= 2:
                                            if m_type == "above":
                                                up_price = float(prices[0])
                                                down_price = float(prices[1])
                                                up_token_id = clob_token_ids[0]
                                                down_token_id = clob_token_ids[1]
                                            else:
                                                down_price = float(prices[0])
                                                up_price = float(prices[1])
                                                down_token_id = clob_token_ids[0]
                                                up_token_id = clob_token_ids[1]
                                                
                                            active_markets.append({
                                                "symbol": symbol,
                                                "bet_type": "strike",
                                                "slug": m.get("slug"),
                                                "up_price": up_price,
                                                "down_price": down_price,
                                                "up_token_id": up_token_id,
                                                "down_token_id": down_token_id,
                                                "title": m.get("question"),
                                                "strike_price": strike_price
                                            })
            except Exception as e:
                logger.error(f"Error fetching dynamic query {q}: {e}")
            await asyncio.sleep(0.1)

    _active_markets_cache = active_markets
    _active_markets_cache_time = now
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

    # 2.5. Fetch recent trade outcomes & post-mortems for this symbol
    recent_trades_context = ""
    try:
        recent_trades = await database.get_recent_resolved_trades_with_feedback(symbol=symbol, limit=3)
        if recent_trades:
            recent_trades_context = "\nRecent Trade Outcomes and Post-Mortems for Reinforcement:\n"
            for t in recent_trades:
                recent_trades_context += f"- Direction: {t['direction']}, Ref Price: ${t['ref_price']:.2f}, Purchase Price: ${t['entry_price']:.2f}, Status: {t['status'].upper()}, Feedback: {t.get('post_mortem', '')}\n"
    except Exception as fe:
        logger.debug(f"Failed to fetch trade feedback context: {fe}")

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
        f"- 90-day: {variations.get(90)}\n"
        f"{recent_trades_context}\n"
        "Please optimize these settings and output the JSON block."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    response_text = await call_groq_api(messages, model="llama-3.1-8b-instant")
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
        
        # Fetch recent resolved trades with feedback context
        recent_trades_feedback = ""
        try:
            recent_trades = await database.get_recent_resolved_trades_with_feedback(limit=5)
            if recent_trades:
                recent_trades_feedback = "\nRecent Resolved Trades Post-Mortem Feedback:\n"
                for t in recent_trades:
                    recent_trades_feedback += f"- Asset: {t['symbol']}, Dir: {t['direction']}, Status: {t['status'].upper()}, PnL: ${t['profit']:+.2f}, Feedback: {t.get('post_mortem', '')}\n"
        except Exception as fe:
            logger.debug(f"Failed to fetch CRO portfolio feedback context: {fe}")

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
            f"Active Risk Profile: {current_risk_profile}\n"
            f"{recent_trades_feedback}\n"
            "Please evaluate these metrics and output the JSON block."
        )
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        response_text = await call_groq_api(messages, model="llama-3.1-8b-instant")
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

async def run_trade_post_mortem(trade_id: int, symbol: str, direction: str, ref_price: float, entry_price: float, status: str, final_price: float):
    """
    Runs an LLM agent to analyze a resolved trade's outcome and generate a feedback memory.
    """
    logger.info(f"AI Agent: Running Post-Mortem Analysis for resolved trade {trade_id} ({symbol} {direction})")
    
    system_prompt = (
        "You are a Senior Quantitative Analyst doing a post-mortem review of a completed prediction market trade.\n\n"
        "Your goal is to write a highly concise, professional analysis (in Turkish, max 2-3 sentences) explaining "
        "why the trade won or lost, and whether the market regime or parameter settings (lookback, yield, edge) "
        "played a role. Do not repeat the inputs, focus on the structural cause of the outcome.\n\n"
        "You must respond ONLY with a raw JSON object containing these keys:\n"
        "- 'post_mortem': string (concise explanation in Turkish)\n"
        "- 'key_takeaway': string (one-sentence takeaway/rule for parameter tuning)"
    )
    
    user_prompt = (
        f"Asset: {symbol}\n"
        f"Bet Direction: {direction}\n"
        f"Reference Price: ${ref_price:.2f}\n"
        f"Entry Purchase Price: ${entry_price:.2f} (Implied probability: {entry_price * 100:.1f}%)\n"
        f"Trade Resolution Status: {status.upper()}\n"
        f"Final Spot/Open/Close Price: ${final_price:.2f}\n\n"
        "Analyze the structural reason of this result and output the JSON block."
    )
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    response_text = await call_groq_api(messages, model="llama-3.1-8b-instant")
    try:
        decision = json.loads(response_text)
        analysis = decision.get("post_mortem", "Analiz yapılamadı.")
        takeaway = decision.get("key_takeaway", "")
        full_feedback = f"{analysis} Ana çıkarım: {takeaway}"
        
        # Save to database
        await database.update_trade_post_mortem(trade_id, full_feedback)
        logger.info(f"AI Agent: Post-Mortem feedback saved for trade {trade_id}: {full_feedback}")
    except Exception as e:
        logger.error(f"Failed to process trade post-mortem: {e}. Response was: {response_text}")

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
                try:
                    trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
                    msg = (
                        f"🏁 <b>[İŞLEM SONUÇLANDI ({trading_mode})]</b>\n\n"
                        f"<b>Enstrüman:</b> {symbol}\n"
                        f"<b>Yön:</b> {direction}\n"
                        f"<b>Sonuç:</b> {status.upper()} {'✅' if status == 'won' else '❌'}\n"
                        f"<b>Açılış:</b> ${open_price:.2f} (Referans: ${ref_price:.2f})"
                    )
                    await send_telegram_message(msg)
                except Exception as tg_err:
                    logger.error(f"Telegram resolve notification failed: {tg_err}")
                
                summary = f"Sanal Islem Cozuldu: {symbol} {direction} -> {status.upper()} (Acilis: ${open_price:.2f} vs Ref: ${ref_price:.2f})"
                await database.add_agent_log(
                    "Decision", 
                    summary, 
                    f"Acilis fiyati: ${open_price:.2f}. Referans fiyati: ${ref_price:.2f}. Kazanan Yon: {win_dir}."
                )
                logger.info(f"AI Agent: {summary}")
                
                # Trigger LLM Post-Mortem Analysis
                await run_trade_post_mortem(trade_id, symbol, direction, ref_price, entry_price, status, open_price)
                
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
                try:
                    trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
                    msg = (
                        f"🏁 <b>[İŞLEM SONUÇLANDI ({trading_mode})]</b>\n\n"
                        f"<b>Enstrüman:</b> {symbol}\n"
                        f"<b>Yön:</b> {direction}\n"
                        f"<b>Sonuç:</b> {status.upper()} {'✅' if status == 'won' else '❌'}\n"
                        f"<b>Kapanış:</b> ${close_price:.2f} (Referans: ${ref_price:.2f})"
                    )
                    await send_telegram_message(msg)
                except Exception as tg_err:
                    logger.error(f"Telegram resolve notification failed: {tg_err}")
                
                summary = f"Sanal Islem Cozuldu: {symbol} {direction} -> {status.upper()} (Kapanis: ${close_price:.2f} vs Ref: ${ref_price:.2f})"
                await database.add_agent_log(
                    "Decision", 
                    summary, 
                    f"Kapanis fiyati: ${close_price:.2f}. Referans fiyati: ${ref_price:.2f}. Kazanan Yon: {win_dir}."
                )
                logger.info(f"AI Agent: {summary}")
                
                # Trigger LLM Post-Mortem Analysis
                await run_trade_post_mortem(trade_id, symbol, direction, ref_price, entry_price, status, close_price)
                
    if resolved_any:
        await database.record_portfolio_history()

async def check_and_apply_stop_losses():
    """Evaluates open positions, re-runs risk/probability analysis, and closes positions (stop loss) if needed."""
    logger.info("AI Agent: Running stop-loss and risk re-evaluation for open positions...")
    open_trades = await database.get_open_virtual_trades()
    if not open_trades:
        return

    import pyth_client
    import backtester
    
    et_tz = pytz.timezone("US/Eastern")
    now_et = datetime.now(et_tz)
    total_minutes = now_et.hour * 60 + now_et.minute
    
    risk_profile = await database.get_risk_profile()
    if risk_profile == "CONSERVATIVE":
        stop_threshold = 0.45
    elif risk_profile == "AGGRESSIVE":
        stop_threshold = 0.30
    else: # MODERATE
        stop_threshold = 0.38

    trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()

    for t in open_trades:
        trade_id = t["id"]
        symbol = t["symbol"]
        direction = t["direction"]
        ref_price = t["ref_price"]
        
        # Skip OPEN_UP / OPEN_DOWN bets as they resolve at 9:30 AM open and don't change value intraday
        if direction.startswith("OPEN_"):
            continue

        try:
            pyth_id, full_symbol = pyth_client.get_pyth_id(symbol)
            if not pyth_id:
                continue
                
            current_price = await pyth_client.get_active_price(symbol, pyth_id)
            if not current_price:
                continue
                
            # Fetch actual yesterday's close reference
            from_ts, to_ts = pyth_client.get_previous_close_times(symbol)
            ref_price_yesterday = await pyth_client.get_historical_candle_price(
                full_symbol, pyth_id, from_ts, to_ts, price_type='close'
            )
            if not ref_price_yesterday:
                continue

            # Check if the position is currently going against us (losing zone)
            is_losing = False
            if direction == "UP":
                is_losing = (current_price < ref_price)
            elif direction == "DOWN":
                is_losing = (current_price > ref_price)

            # Only re-evaluate if it's currently losing
            if not is_losing:
                continue

            # Calculate minutes remaining to close
            close_minutes = 1020 if any(c in symbol for c in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]) else 960
            minutes_to_close = max(0, close_minutes - total_minutes)

            # Get active parameter tuning from DB
            tuning = await database.get_tuning(symbol, "close")
            lookback = tuning["lookback_days"]

            # Determine if it is a strike bet vs close bet
            # If the stored ref_price is significantly different from ref_price_yesterday, it's a strike price!
            is_strike = abs((ref_price - ref_price_yesterday) / ref_price_yesterday) > 0.005 # > 0.5% difference
            
            if is_strike:
                res = await backtester.backtest_strike_bet(
                    symbol=symbol,
                    current_price=current_price,
                    ref_price=ref_price_yesterday,
                    strike_price=ref_price,
                    direction=direction,
                    minutes_to_close=minutes_to_close,
                    lookback_days=lookback
                )
            else:
                res = await backtester.backtest_close_bet(
                    symbol=symbol,
                    current_price=current_price,
                    ref_price=ref_price,
                    direction=direction,
                    minutes_to_close=minutes_to_close,
                    lookback_days=lookback
                )

            if res.get("status") == "success":
                quant_prob = res["win_rate"] / 100.0
                
                # Trigger Stop Loss if win probability drops below threshold
                if quant_prob < stop_threshold:
                    logger.warning(f"Stop Loss Triggered for {symbol} {direction} (Trade ID: {trade_id}): Prob {quant_prob:.2f} < Threshold {stop_threshold:.2f}")
                    
                    # Close position
                    close_res = await database.close_trade_position(trade_id)
                    if close_res.get("success"):
                        msg = (
                            f"🛑 <b>[STOP-LOSS / RİSK ÇIKIŞI ({trading_mode})]</b>\n\n"
                            f"<b>Enstrüman:</b> {symbol}\n"
                            f"<b>Yön:</b> {direction}\n"
                            f"<b>Mevcut Fiyat:</b> ${current_price:.2f} (Sınır/Referans: ${ref_price:.2f})\n"
                            f"<b>Yeni Kazanma İhtimali:</b> {quant_prob * 100:.1f}%\n"
                            f"<b>Zarar Durdurma Eşiği:</b> {stop_threshold * 100:.0f}%\n"
                            f"<b>Sonuç:</b> Pozisyon kapatıldı. {close_res.get('message', '')}"
                        )
                        await send_telegram_message(msg)
                        
                        await database.add_agent_log(
                            "Decision",
                            f"Stop Loss Tetiklendi: {symbol} {direction}",
                            f"Mevcut fiyat ${current_price:.2f} sınırın/referansın (${ref_price:.2f}) tersine gitti.\n"
                            f"Yeni hesaplanan kazanma ihtimali {quant_prob * 100:.1f}% limit eşiğin ({stop_threshold * 100:.0f}%) altında kaldığı için pozisyon durduruldu."
                        )
                    else:
                        logger.error(f"Failed to execute stop loss closure for trade {trade_id}: {close_res.get('error')}")
        except Exception as e:
            logger.error(f"Error checking stop loss for trade {trade_id} ({symbol}): {e}", exc_info=True)

async def run_autonomous_scan_cycle():
    """Main scanning cycle to compare Polymarket prices vs historical Quant win-rates."""
    logger.info("AI Agent: Starting scanning cycle...")
    
    # 1. Resolve open trades
    await resolve_virtual_trades()
    
    # 1b. Auto-detect and sync real Polymarket positions
    await auto_detect_clob_positions()
    
    # 1c. Check and apply stop-loss / risk re-evaluation
    await check_and_apply_stop_losses()
    
    # 2. Archive active signals
    await database.archive_all_signals()
 
    # 3. Get global risk profile and determine trading mode / limits
    risk_profile = await database.get_risk_profile()
    trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
    portfolio = await database.get_portfolio()
    total_capital = portfolio["equity"]

    # Fetch trading restrictions from global_settings
    block_stocks_down = await database.get_setting("block_stocks_down") == "true"
    block_commodities_down = await database.get_setting("block_commodities_down") == "true"
    
    # Check general hour ban (Turkey Time)
    is_trading_banned = False
    ban_start_str = "22:00"
    ban_end_str = "08:00"
    trading_ban_enabled = await database.get_setting("trading_ban_enabled") == "true"
    if trading_ban_enabled:
        ban_start_str = await database.get_setting("trading_ban_start") or "22:00"
        ban_end_str = await database.get_setting("trading_ban_end") or "08:00"
        try:
            tr_tz = pytz.timezone("Europe/Istanbul")
            now_tr = datetime.now(tr_tz)
            sh, sm = map(int, ban_start_str.split(":"))
            eh, em = map(int, ban_end_str.split(":"))
            ch, cm = now_tr.hour, now_tr.minute
            
            start_mins = sh * 60 + sm
            end_mins = eh * 60 + em
            curr_mins = ch * 60 + cm
            
            if start_mins <= end_mins:
                if start_mins <= curr_mins <= end_mins:
                    is_trading_banned = True
            else:
                if curr_mins >= start_mins or curr_mins <= end_mins:
                    is_trading_banned = True
        except Exception as ban_err:
            logger.error(f"Error evaluating trading ban: {ban_err}")

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
        tuning = await database.get_tuning(symbol, "close" if bet_type == "strike" else bet_type)
        lookback = tuning["lookback_days"]
        min_yield = tuning["min_expected_yield"]
 
        pyth_id, full_symbol = pyth_client.get_pyth_id(symbol)
        if not pyth_id:
            continue
 
        current_price = await pyth_client.get_active_price(symbol, pyth_id)
        if not current_price:
            continue
 
        # Get yesterday's close reference
        from_ts, to_ts = pyth_client.get_previous_close_times(symbol)
        ref_price = await pyth_client.get_historical_candle_price(
            full_symbol, pyth_id, from_ts, to_ts, price_type='close'
        )
        if not ref_price:
            continue
 
        close_minutes = 1020 if any(c in symbol for c in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]) else 960
        minutes_to_close = max(0, close_minutes - total_minutes)
 
        # Perform backtests for both UP and DOWN outcomes
        for direction in ["UP", "DOWN"]:
            poly_prob = up_price if direction == "UP" else down_price
            if poly_prob < 0.45:  # Strict user rule: do not buy contracts priced below 45c (0.45)
                continue
 
            if bet_type == "open":
                res = await backtester.backtest_open_bet(symbol, direction, lookback)
            elif bet_type == "strike":
                res = await backtester.backtest_strike_bet(symbol, current_price, ref_price, m["strike_price"], direction, minutes_to_close, lookback)
            else:
                res = await backtester.backtest_close_bet(symbol, current_price, ref_price, direction, minutes_to_close, lookback)
 
            quant_prob = res["win_rate"] / 100.0
            edge = quant_prob - poly_prob
            
            # Expected yield on Polymarket: (1 - purchase_price) / purchase_price * 100
            expected_yield = ((1.0 - poly_prob) / poly_prob * 100) if poly_prob > 0 else 0.0
 
            # Filter: We look for opportunities where:
            # - Real quant probability of winning is high (e.g. >= 85%) AND expected yield meets the minimum yield
            # - OR there is a significant pricing edge (e.g. real probability is X% higher than Polymarket price)
            is_significant_edge = edge >= required_edge_threshold
            is_high_prob_yield = (quant_prob >= 0.88) and (expected_yield >= min_yield)
            
            # Rule 3: Late night 95-99c override (after 22:00 TRT)
            is_late_night_override = False
            tr_tz = pytz.timezone("Europe/Istanbul")
            now_tr = datetime.now(tr_tz)
            if now_tr.hour >= 22 and 0.95 <= poly_prob <= 0.99 and quant_prob >= 0.90:
                is_late_night_override = True
                logger.info(f"AI Agent: Late night 95-99c override triggered for {symbol} {direction} at price {poly_prob:.2f} (quant_prob: {quant_prob:.2f})")
            
            if is_significant_edge or is_high_prob_yield or is_late_night_override:
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
                sig_ref = m["strike_price"] if bet_type == "strike" else ref_price
                sig_diff = ((current_price - sig_ref) / sig_ref) * 100
                await database.add_signal(
                    symbol=symbol,
                    direction=f"OPEN_{direction}" if bet_type == "open" else direction,
                    ref_price=sig_ref,
                    current_price=current_price,
                    diff_pct=sig_diff,
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
                
                # Check custom restrictions
                if direction == "DOWN":
                    is_stock = symbol in ["SPY", "PLTR", "TSLA", "NVDA", "AAPL", "AMZN", "META", "GOOGL", "MSFT", "NFLX", "COIN", "HOOD", "ABNB", "RKLB", "EWY", "MU"]
                    is_commodity = any(c in symbol for c in ["WTI", "XAU", "XAG", "GOLD", "SILVER"])
                    if is_stock and block_stocks_down:
                        logger.info(f"AI Agent: Skipping trade candidate {symbol} {trade_dir} because Stock DOWN trading is blocked today.")
                        continue
                    if is_commodity and block_commodities_down:
                        logger.info(f"AI Agent: Skipping trade candidate {symbol} {trade_dir} because Commodity DOWN trading is blocked today.")
                        continue
                        
                if is_trading_banned:
                    logger.info(f"AI Agent: Skipping trade candidate {symbol} {trade_dir} due to active trading ban hour restriction ({ban_start_str} - {ban_end_str} TRT).")
                    continue
                
                # Turkey time check: 
                tr_tz = pytz.timezone("Europe/Istanbul")
                now_tr = datetime.now(tr_tz)
                
                # Rule 1: No trades before 14:00 TRT
                if now_tr.hour < 14:
                    logger.info(f"AI Agent: Skipping trade candidate {symbol} {trade_dir} before 14:00 TRT.")
                    continue
                    
                # Rule 1b: Before 21:00 TRT and the trade is not very guaranteed (quant_prob < 0.90), skip execution
                if now_tr.hour < 21 and quant_prob < 0.90:
                    logger.info(f"AI Agent: Skipping trade candidate {symbol} {trade_dir} before 21:00 TRT (quant_prob {quant_prob:.2f} < 0.90)")
                    continue
                    
                # Rule 1c: If total capital is below $1,000, enforce 100% win-rate (0% reversal rate) i.e. quant_prob must be >= 1.0
                if total_capital < 1000.0 and quant_prob < 1.0:
                    logger.info(f"AI Agent: Skipping trade candidate {symbol} {trade_dir} because account equity is ${total_capital:.2f} (< $1000) and quant_prob {quant_prob:.4f} < 1.0 (requires 100% win-rate/0% reversal)")
                    continue
                
                trade_candidates.append({
                    "symbol": symbol,
                    "direction": trade_dir,
                    "ref_price": sig_ref,
                    "entry_price": poly_prob,
                    "edge": edge,
                    "slug": slug,
                    "token_id": token_id,
                    "quant_probability": quant_prob
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
                    
                    # Check if it is a lottery bet (win probability below risk profile threshold)
                    is_lottery = cand.get("quant_probability", 1.0) < min_win_prob
                    
                    is_last = (idx == len(new_candidates) - 1)
                    if is_last and not is_lottery:
                        size_to_trade = remaining_budget
                    else:
                        share = remaining_budget / (len(new_candidates) - idx)
                        size_to_trade = max(2.0, share)
                        
                    # Rule 2: Limit single trade size to 15-20% (use 20% max cap) of total equity
                    max_cap = equity * 0.20
                    size_to_trade = min(size_to_trade, max_cap)
                        
                    # If lottery, cap at max 3% of total equity
                    if is_lottery:
                        max_lottery_size = equity * 0.03
                        size_to_trade = min(size_to_trade, max_lottery_size)
                        
                    if size_to_trade > remaining_budget:
                        size_to_trade = remaining_budget
                            
                    if size_to_trade >= 2.0:
                        spent = await database.open_virtual_trade(
                            symbol=cand["symbol"],
                            direction=cand["direction"],
                            ref_price=cand["ref_price"],
                            entry_price=cand["entry_price"],
                            size_usd=size_to_trade,
                            polymarket_slug=cand["slug"],
                            clob_token_id=cand["token_id"]
                        )
                        if spent > 0.0:
                            remaining_budget -= spent
                            shares = spent / cand["entry_price"]
                            await database.add_agent_log(
                                "Decision",
                                f"Gerçek İşlem Açıldı (Lottery Capped): {cand['symbol']} {cand['direction']}" if is_lottery else f"Gerçek İşlem Açıldı: {cand['symbol']} {cand['direction']}",
                                f"Pozisyon açıldı: {shares:.2f} adet hisse ${cand['entry_price']:.2f} fiyattan satın alındı (Toplam: ${spent:.2f}).\n"
                                f"Risk Profili: {risk_profile}. Referans Fiyat: ${cand['ref_price']:.2f}."
                            )
                            logger.info(f"AI Agent: Real trade opened: {cand['symbol']} {cand['direction']} (Size: ${spent:.2f}, Lottery: {is_lottery})")
                            try:
                                msg = (
                                    f"🔔 <b>[GERÇEK İŞLEM AÇILDI]</b>\n\n"
                                    f"<b>Enstrüman:</b> {cand['symbol']}\n"
                                    f"<b>Yön:</b> {cand['direction']}{' (Lottery Capped)' if is_lottery else ''}\n"
                                    f"<b>Büyüklük:</b> ${spent:.2f}\n"
                                    f"<b>Giriş Fiyatı:</b> ${cand['entry_price']:.2f}\n"
                                    f"<b>Kazanma İhtimali:</b> {cand['quant_probability'] * 100:.1f}%\n"
                                    f"<b>Piyasa:</b> {cand['slug']}"
                                )
                                await send_telegram_message(msg)
                            except Exception as tg_err:
                                logger.error(f"Telegram real trade open notification failed: {tg_err}")
        else:
            # Virtual trading mode logic (uses standard trade_size_usd per trade, but caps at remaining balance)
            for cand in new_candidates:
                port = await database.get_portfolio()
                balance = port["balance"]
                equity = port["equity"]
                
                size_to_trade = trade_size_usd
                # Rule 2: Limit single trade size to 15-20% (use 20% max cap) of total equity
                max_cap = equity * 0.20
                size_to_trade = min(size_to_trade, max_cap)
                
                if balance < size_to_trade:
                    if balance >= 2.0:
                        size_to_trade = balance
                    else:
                        continue
                        
                spent = await database.open_virtual_trade(
                    symbol=cand["symbol"],
                    direction=cand["direction"],
                    ref_price=cand["ref_price"],
                    entry_price=cand["entry_price"],
                    size_usd=size_to_trade,
                    polymarket_slug=cand["slug"],
                    clob_token_id=cand["token_id"]
                )
                if spent > 0.0:
                    shares = spent / cand["entry_price"]
                    await database.add_agent_log(
                        "Decision",
                        f"Sanal İşlem Açıldı: {cand['symbol']} {cand['direction']}",
                        f"Sanal pozisyon açıldı: {shares:.2f} adet hisse ${cand['entry_price']:.2f} fiyattan satın alındı (Toplam: ${spent:.2f}).\n"
                        f"Risk Profili: {risk_profile}. Referans Fiyat: ${cand['ref_price']:.2f}."
                    )
                    logger.info(f"AI Agent: Virtual trade opened: {cand['symbol']} {cand['direction']} (Size: ${spent:.2f})")
                    try:
                        msg = (
                            f"🧪 <b>[SANAL İŞLEM AÇILDI]</b>\n\n"
                            f"<b>Enstrüman:</b> {cand['symbol']}\n"
                            f"<b>Yön:</b> {cand['direction']}\n"
                            f"<b>Büyüklük:</b> ${spent:.2f}\n"
                            f"<b>Giriş Fiyatı:</b> ${cand['entry_price']:.2f}\n"
                            f"<b>Kazanma İhtimali:</b> {cand['quant_probability'] * 100:.1f}%\n"
                            f"<b>Piyasa:</b> {cand['slug']}"
                        )
                        await send_telegram_message(msg)
                    except Exception as tg_err:
                        logger.error(f"Telegram virtual trade open notification failed: {tg_err}")
                        
    # Record portfolio value after scan cycle completes
    await database.record_portfolio_history()
    
    # Daily Balance Update via Telegram (Turkey Time)
    try:
        tr_tz = pytz.timezone("Europe/Istanbul")
        now_tr = datetime.now(tr_tz)
        today_str = now_tr.strftime("%Y-%m-%d")
        
        # 1. Stocks Report (Hisseler) at 23:03 TRT
        if now_tr.hour == 23 and 3 <= now_tr.minute < 8:
            last_sent = await database.get_setting("last_telegram_stock_report_date")
            if last_sent != today_str:
                port = await database.get_portfolio()
                balance = port["balance"]
                equity = port["equity"]
                
                # Fetch open stock trades
                open_trades = await database.get_open_virtual_trades()
                open_stocks = [t for t in open_trades if t["symbol"] not in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]]
                
                # Fetch resolved stock trades in last 24 hours
                time_threshold = (datetime.now() - timedelta(hours=24)).isoformat()
                pool = await database.get_pool()
                async with pool.acquire() as conn:
                    resolved = await conn.fetch(
                        "SELECT symbol, status, profit FROM virtual_trades WHERE status IN ('won', 'lost') AND resolved_at >= $1",
                        time_threshold
                    )
                
                resolved_stocks = [r for r in resolved if r["symbol"] not in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]]
                
                total_wins = sum(1 for r in resolved_stocks if r["status"] == "won")
                total_losses = sum(1 for r in resolved_stocks if r["status"] == "lost")
                total_profit = sum(float(r["profit"]) for r in resolved_stocks)
                
                msg = (
                    f"📊 <b>[GÜNLÜK HİSSE RAPORU - {today_str}]</b>\n\n"
                    f"<b>Mod:</b> {trading_mode}\n"
                    f"<b>Net Varlık (Equity):</b> ${equity:.2f}\n"
                    f"<b>Boştaki Bakiye (Balance):</b> ${balance:.2f}\n\n"
                    f"<b>Aktif Açık Hisseler:</b> {len(open_stocks)} adet\n"
                    f"<b>Son 24s Sonuçlanan Hisseler:</b> {len(resolved_stocks)} adet "
                    f"(✅ {total_wins} / ❌ {total_losses})\n"
                    f"<b>Hisseler Kar/Zarar:</b> ${total_profit:+.2f}"
                )
                await send_telegram_message(msg)
                await database.update_setting("last_telegram_stock_report_date", today_str)

        # 2. Commodities Report (Petrol / Altın / Gümüş) at 00:05 TRT
        if now_tr.hour == 0 and 5 <= now_tr.minute < 10:
            last_sent = await database.get_setting("last_telegram_commodity_report_date")
            if last_sent != today_str:
                port = await database.get_portfolio()
                balance = port["balance"]
                equity = port["equity"]
                
                # Fetch open commodity trades
                open_trades = await database.get_open_virtual_trades()
                open_commodities = [t for t in open_trades if t["symbol"] in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]]
                
                # Fetch resolved commodity trades in last 24 hours
                time_threshold = (datetime.now() - timedelta(hours=24)).isoformat()
                pool = await database.get_pool()
                async with pool.acquire() as conn:
                    resolved = await conn.fetch(
                        "SELECT symbol, status, profit FROM virtual_trades WHERE status IN ('won', 'lost') AND resolved_at >= $1",
                        time_threshold
                    )
                
                resolved_commodities = [r for r in resolved if r["symbol"] in ["WTI", "XAU", "XAG", "GOLD", "SILVER"]]
                
                total_wins = sum(1 for r in resolved_commodities if r["status"] == "won")
                total_losses = sum(1 for r in resolved_commodities if r["status"] == "lost")
                total_profit = sum(float(r["profit"]) for r in resolved_commodities)
                
                msg = (
                    f"🛢️ <b>[GÜNLÜK EMTİA RAPORU - {today_str}]</b>\n\n"
                    f"<b>Mod:</b> {trading_mode}\n"
                    f"<b>Net Varlık (Equity):</b> ${equity:.2f}\n"
                    f"<b>Boştaki Bakiye (Balance):</b> ${balance:.2f}\n\n"
                    f"<b>Aktif Açık Emtialar:</b> {len(open_commodities)} adet\n"
                    f"<b>Son 24s Sonuçlanan Emtialar:</b> {len(resolved_commodities)} adet "
                    f"(✅ {total_wins} / ❌ {total_losses})\n"
                    f"<b>Emtia Kar/Zarar:</b> ${total_profit:+.2f}"
                )
                await send_telegram_message(msg)
                await database.update_setting("last_telegram_commodity_report_date", today_str)
                
    except Exception as eod_err:
        logger.error(f"Error executing daily Telegram summary: {eod_err}")

async def agent_scheduler_loop():
    """Background task runner for the AI Agent."""
    logger.info("Starting AI Quant Agent Loop...")
    await database.init_db()

    # Wait for pyth feed cache to initialize in main application
    await asyncio.sleep(10)
    
    # Auto-detect real positions on startup immediately
    await auto_detect_clob_positions()
    
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

async def position_sync_loop():
    """Background loop to sync and auto-detect real positions frequently."""
    logger.info("Starting Position Sync Loop...")
    await asyncio.sleep(15)  # wait for initialization
    while True:
        try:
            await auto_detect_clob_positions()
        except Exception as e:
            logger.error(f"Error in position sync loop: {e}")
        await asyncio.sleep(30)  # check every 30 seconds

def start_agent_task():
    """Start the AI Agent background thread."""
    asyncio.create_task(agent_scheduler_loop())
    asyncio.create_task(position_sync_loop())
