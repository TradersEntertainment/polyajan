import asyncio
import httpx
import logging
import pytz
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

BENCHMARKS_URL = "https://benchmarks.pyth.network/v1"

# Hardcoded Pyth symbol map (shares mapping with the tracker system)
SYMBOL_MAP = {
    "SPY": "Equity.US.SPY/USD",
    "PLTR": "Equity.US.PLTR/USD",
    "AAPL": "Equity.US.AAPL/USD",
    "TSLA": "Equity.US.TSLA/USD",
    "AMZN": "Equity.US.AMZN/USD",
    "NVDA": "Equity.US.NVDA/USD",
    "HOOD": "Equity.US.HOOD/USD",
    "META": "Equity.US.META/USD",
    "GOOGL": "Equity.US.GOOGL/USD",
    "ABNB": "Equity.US.ABNB/USD",
    "OPEN": "Equity.US.OPEN/USD",
    "MSFT": "Equity.US.MSFT/USD",
    "COIN": "Equity.US.COIN/USD",
    "NFLX": "Equity.US.NFLX/USD",
    "RKLB": "Equity.US.RKLB/USD",
    "MU": "Equity.US.MU/USD",
    "EWY": "Equity.US.EWY/USD",
    "WTI": "Commodities.USOILSPOT",
    "GOLD": "Metal.XAU/USD",
    "XAU": "Metal.XAU/USD",
    "SILVER": "Metal.XAG/USD",
    "XAG": "Metal.XAG/USD",
    "NG": "Crypto.NG/USD",
    "RUT": "Index.US.RUT/USD",
    "HSI": "Index.HK.HSI/HKD",
    "DIA": "Index.US.DJI/USD",
    "DAX": "Index.EU.DAX/EUR",
    "NKY": "Index.JP.NI225/JPY",
    "UKX": "Index.GB.FTSE/GBP",
    "NYA": "Index.US.NYA/USD"
}

# Local in-memory cache to avoid redundant API queries
_history_cache = {} # symbol -> { 'loaded_at': timestamp, 'days': [...] }

async def fetch_historical_candles(symbol: str, lookback_days: int) -> list:
    """Fetches hourly candles from Pyth TradingView history API."""
    symbol_up = symbol.upper()
    full_symbol = SYMBOL_MAP.get(symbol_up)
    if not full_symbol:
        logger.error(f"Unknown symbol: {symbol_up}")
        return []

    # Check cache (cache valid for 4 hours)
    import time
    now_ts = time.time()
    cache_entry = _history_cache.get(symbol_up)
    if cache_entry and (now_ts - cache_entry['loaded_at'] < 14400):
        return cache_entry['days']

    et_tz = pytz.timezone("US/Eastern")
    now_et = datetime.now(et_tz)
    
    # Pad lookback days to account for weekends/holidays
    padding_days = int(lookback_days * 1.5) + 10
    from_dt = now_et - timedelta(days=padding_days)
    from_ts = int(from_dt.timestamp())
    to_ts = int(now_et.timestamp())

    url = f"{BENCHMARKS_URL}/shims/tradingview/history"
    params = {
        "symbol": full_symbol,
        "resolution": "60",  # 1-hour candles
        "from": from_ts,
        "to": to_ts,
    }

    retries = 3
    data = None
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, params=params, timeout=15.0)
                if resp.status_code == 429:
                    await asyncio.sleep(2.0 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
        except Exception as e:
            if attempt == retries - 1:
                logger.error(f"Failed to fetch history for {symbol_up}: {e}")
                return []
            await asyncio.sleep(2.0)

    if not data or data.get("s") != "ok" or "t" not in data:
        return []

    timestamps = data["t"]
    opens = data["o"]
    highs = data["h"]
    lows = data["l"]
    closes = data["c"]

    # Group hourly candles by trading day (US/Eastern)
    daily_candles = {}
    for i, ts in enumerate(timestamps):
        dt = datetime.fromtimestamp(ts, tz=et_tz)
        date_str = dt.strftime("%Y-%m-%d")
        if date_str not in daily_candles:
            daily_candles[date_str] = []
        daily_candles[date_str].append({
            "hour": dt.hour,
            "minute": dt.minute,
            "open": opens[i],
            "high": highs[i],
            "low": lows[i],
            "close": closes[i],
        })

    # Compile daily summary files
    sorted_dates = sorted(daily_candles.keys())
    trading_days = []

    for idx in range(1, len(sorted_dates)):
        prev_date = sorted_dates[idx - 1]
        curr_date = sorted_dates[idx]
        prev_c = daily_candles[prev_date]
        curr_c = daily_candles[curr_date]

        if not prev_c or not curr_c:
            continue

        prev_close = prev_c[-1]["close"]
        final_close = curr_c[-1]["close"]
        first_open = curr_c[0]["open"]

        if prev_close == 0:
            continue

        final_diff_pct = ((final_close - prev_close) / prev_close) * 100
        final_direction = "UP" if final_diff_pct > 0 else "DOWN"

        # Generate snapshots at each hour
        snapshots = []
        for candle in curr_c:
            price = candle["open"]
            diff = ((price - prev_close) / prev_close) * 100
            low_pct = ((candle["low"] - prev_close) / prev_close) * 100
            high_pct = ((candle["high"] - prev_close) / prev_close) * 100
            
            is_commodity = any(c in symbol_up for c in ["WTI", "XAU", "XAG", "GOLD", "SILVER"])
            close_mins = 1020 if is_commodity else 960
            minutes_to_close = max(0, close_mins - (candle["hour"] * 60 + candle["minute"]))
            
            snapshots.append({
                "hour": candle["hour"],
                "price": price,
                "diff_pct": diff,
                "low_pct": low_pct,
                "high_pct": high_pct,
                "direction": "UP" if diff > 0 else "DOWN",
                "minutes_to_close": minutes_to_close
            })

        trading_days.append({
            "date": curr_date,
            "prev_close": prev_close,
            "first_open": first_open,
            "final_close": final_close,
            "final_diff_pct": final_diff_pct,
            "final_direction": final_direction,
            "snapshots": snapshots
        })

    # Limit to required lookback history (filter sorted descending to take last N days)
    trading_days = trading_days[-lookback_days:]
    _history_cache[symbol_up] = {
        'loaded_at': now_ts,
        'days': trading_days
    }
    return trading_days

async def backtest_open_bet(symbol: str, direction: str, lookback_days: int) -> dict:
    """
    Backtests an S&P 500 / Stock open bet.
    Compares the opening price at 09:30 ET against previous day's close.
    """
    days = await fetch_historical_candles(symbol, lookback_days)
    if not days:
        return {"win_rate": 0.0, "total_days": 0, "win_count": 0, "status": "no_data"}

    win_count = 0
    total_days = len(days)
    target_dir = direction.upper()

    for day in days:
        opened_up = day["first_open"] > day["prev_close"]
        if target_dir == "UP" and opened_up:
            win_count += 1
        elif target_dir == "DOWN" and not opened_up:
            win_count += 1

    win_rate = (win_count / total_days * 100) if total_days > 0 else 0.0
    return {
        "win_rate": win_rate,
        "total_days": total_days,
        "win_count": win_count,
        "status": "success"
    }

async def backtest_close_bet(symbol: str, current_price: float, ref_price: float, direction: str, minutes_to_close: int, lookback_days: int) -> dict:
    """
    Backtests standard Up/Down market close positions.
    Evaluates whether the price reversed vs reference at close after hitting current levels at this hour.
    """
    days = await fetch_historical_candles(symbol, lookback_days)
    if not days:
        return {"win_rate": 0.0, "total_similar_days": 0, "reversed_count": 0, "status": "no_data"}

    current_diff_pct = ((current_price - ref_price) / ref_price) * 100
    current_direction = "UP" if current_diff_pct >= 0 else "DOWN"
    target_dir = direction.upper()
    abs_diff = abs(current_diff_pct)

    if abs_diff < 0.05:
        return {"win_rate": 0.0, "total_similar_days": 0, "reversed_count": 0, "status": "too_close"}

    at_level = []
    similar = []

    for day in days:
        best_match = None
        for snap in day["snapshots"]:
            # Match the historical snapshot direction to the ACTUAL current direction
            if snap["direction"] != current_direction:
                continue
            # Look for snapshots around the same minutes to close window (+/- 30 mins)
            if abs(snap["minutes_to_close"] - minutes_to_close) > 30:
                continue
            if best_match is None or abs(snap["minutes_to_close"] - minutes_to_close) < abs(best_match["minutes_to_close"] - minutes_to_close):
                best_match = snap

        if best_match is None:
            continue

        snap_abs = abs(best_match["diff_pct"])
        # Did it reverse from current_direction at close?
        reversed_flag = day["final_direction"] != current_direction

        # Did we win this contract?
        # If target_dir == current_direction: we win if it did NOT reverse (continuation).
        # If target_dir != current_direction: we win if it DID reverse (reversal).
        is_win = (target_dir == current_direction and not reversed_flag) or (target_dir != current_direction and reversed_flag)

        entry = {
            "date": day["date"],
            "is_win": is_win
        }

        # Check tolerance ranges
        if snap_abs >= abs_diff * 0.9:
            at_level.append(entry)
        if snap_abs >= abs_diff * 0.5:
            similar.append(entry)

    # Use conservative pool if we have enough sample sizes
    if len(at_level) >= 3:
        sample_pool = at_level
    else:
        sample_pool = similar

    total_similar = len(sample_pool)
    win_count = sum(1 for e in sample_pool if e["is_win"])
    win_rate = (win_count / total_similar * 100) if total_similar > 0 else 0.0

    return {
        "win_rate": win_rate,
        "total_similar_days": total_similar,
        "win_count": win_count,
        "status": "success"
    }

async def backtest_strike_bet(symbol: str, current_price: float, ref_price: float, strike_price: float, direction: str, minutes_to_close: int, lookback_days: int) -> dict:
    """
    Backtests strike-based close options (e.g. SPY closes above $530).
    Uses the scaled ratio approach:
      strike_ratio = strike_price / ref_price
      For each historical day, the scaled strike is:
        hist_strike = day["prev_close"] * strike_ratio
      We look at historical days where the price reached a similar relative diff at a similar time,
      and count how many times the final close was above (for direction=UP) or below (for direction=DOWN) the scaled strike.
    """
    days = await fetch_historical_candles(symbol, lookback_days)
    if not days:
        return {"win_rate": 0.0, "total_similar_days": 0, "win_count": 0, "status": "no_data"}

    strike_ratio = strike_price / ref_price
    current_diff_pct = ((current_price - ref_price) / ref_price) * 100
    current_direction = "UP" if current_diff_pct >= 0 else "DOWN"
    target_dir = direction.upper()
    abs_diff = abs(current_diff_pct)

    if abs_diff < 0.01:
        abs_diff = 0.01

    at_level = []
    similar = []

    for day in days:
        best_match = None
        for snap in day["snapshots"]:
            if snap["direction"] != current_direction:
                continue
            if abs(snap["minutes_to_close"] - minutes_to_close) > 30:
                continue
            if best_match is None or abs(snap["minutes_to_close"] - minutes_to_close) < abs(best_match["minutes_to_close"] - minutes_to_close):
                best_match = snap

        if best_match is None:
            continue

        snap_abs = abs(best_match["diff_pct"])
        
        # Calculate scaled strike for this day
        hist_strike = day["prev_close"] * strike_ratio
        
        # Did we close above or below the scaled strike?
        if target_dir == "UP":
            is_win = day["final_close"] > hist_strike
        else:
            is_win = day["final_close"] < hist_strike

        entry = {
            "date": day["date"],
            "is_win": is_win
        }

        # Check tolerance ranges
        if snap_abs >= abs_diff * 0.9:
            at_level.append(entry)
        if snap_abs >= abs_diff * 0.5:
            similar.append(entry)

    # Use conservative pool if we have enough sample sizes
    if len(at_level) >= 3:
        sample_pool = at_level
    else:
        sample_pool = similar

    total_similar = len(sample_pool)
    win_count = sum(1 for e in sample_pool if e["is_win"])
    win_rate = (win_count / total_similar * 100) if total_similar > 0 else 0.0

    return {
        "win_rate": win_rate,
        "total_similar_days": total_similar,
        "win_count": win_count,
        "status": "success"
    }

async def backtest_hit_bet(symbol: str, current_price: float, ref_price: float, target_price: float, minutes_to_close: int, lookback_days: int) -> dict:
    """
    Backtests a hit/touch option (e.g. SPY hits $740) during the remaining session time.
    Calculates the statistical probability of the price touching or crossing the target
    during the remaining minutes of the session, based on historical lookback.
    """
    days = await fetch_historical_candles(symbol, lookback_days)
    if not days:
        return {"win_rate": 0.0, "total_similar_days": 0, "win_count": 0, "status": "no_data"}
        
    target_ratio = target_price / ref_price
    target_diff_pct = (target_ratio - 1.0) * 100
    current_diff_pct = ((current_price - ref_price) / ref_price) * 100
    current_direction = "UP" if current_diff_pct >= 0 else "DOWN"
    abs_diff = abs(current_diff_pct)
    
    if abs_diff < 0.01:
        abs_diff = 0.01
        
    is_target_below = target_price < current_price
    
    at_level = []
    similar = []
    
    for day in days:
        match_idx = -1
        for idx, snap in enumerate(day["snapshots"]):
            if snap["direction"] != current_direction:
                continue
            if abs(snap["minutes_to_close"] - minutes_to_close) > 30:
                continue
            match_idx = idx
            break
            
        if match_idx == -1:
            continue
            
        has_hit = False
        scaled_target_pct = target_diff_pct
        
        for snap in day["snapshots"][match_idx:]:
            if is_target_below:
                if snap.get("low_pct", snap["diff_pct"]) <= scaled_target_pct:
                    has_hit = True
                    break
            else:
                if snap.get("high_pct", snap["diff_pct"]) >= scaled_target_pct:
                    has_hit = True
                    break
                    
        is_win = not has_hit
        
        entry = {
            "date": day["date"],
            "is_win": is_win,
            "has_hit": has_hit
        }
        
        snap_abs = abs(day["snapshots"][match_idx]["diff_pct"])
        if snap_abs >= abs_diff * 0.9:
            at_level.append(entry)
        if snap_abs >= abs_diff * 0.5:
            similar.append(entry)
            
    if len(at_level) >= 3:
        sample_pool = at_level
    else:
        sample_pool = similar
        
    total_similar = len(sample_pool)
    win_count = sum(1 for e in sample_pool if e["is_win"])
    hit_count = sum(1 for e in sample_pool if e["has_hit"])
    
    win_rate = (win_count / total_similar * 100) if total_similar > 0 else 0.0
    hit_rate = (hit_count / total_similar * 100) if total_similar > 0 else 0.0
    
    return {
        "win_rate": win_rate,  # Win rate of NO bet (stays safe)
        "hit_rate": hit_rate,  # Probability of target hit
        "total_similar_days": total_similar,
        "win_count": win_count,
        "status": "success"
    }

