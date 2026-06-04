import os
import asyncpg
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
_pool = None

async def get_pool():
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            # For fallback safety in build phases, load dotenv just in case
            from dotenv import load_dotenv
            load_dotenv()
            url = os.getenv("DATABASE_URL")
            if not url:
                raise ValueError("DATABASE_URL environment variable is not set!")
            _pool = await asyncpg.create_pool(url)
        else:
            _pool = await asyncpg.create_pool(DATABASE_URL)
    return _pool

async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Parameter Tuning table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS parameter_tuning (
                    symbol TEXT NOT NULL,
                    bet_type TEXT NOT NULL, -- 'open' or 'close'
                    lookback_days INTEGER DEFAULT 60,
                    minutes_left_threshold INTEGER DEFAULT 60,
                    min_expected_yield REAL DEFAULT 3.0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (symbol, bet_type)
                )
            """)

            # 2. Quant Signals table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS quant_signals (
                    id SERIAL PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    direction TEXT NOT NULL, -- 'UP', 'DOWN', 'OPEN_UP', 'OPEN_DOWN'
                    ref_price REAL NOT NULL,
                    current_price REAL NOT NULL,
                    diff_pct REAL NOT NULL,
                    polymarket_slug TEXT,
                    polymarket_price REAL, -- implied probability (e.g. 0.65 for 65c)
                    quant_probability REAL, -- calculated historical success rate (e.g. 0.90 for 90%)
                    edge_pct REAL, -- quant_probability - polymarket_price
                    confidence_level TEXT,
                    confidence_stars TEXT,
                    status TEXT DEFAULT 'active',
                    created_at TEXT NOT NULL
                )
            """)

            # 3. Agent Logs table (stores LLM's thought processes)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_logs (
                    id SERIAL PRIMARY KEY,
                    log_type TEXT NOT NULL, -- 'Tuning', 'Decision', 'Info'
                    summary TEXT NOT NULL,
                    details TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)

            # 4. Virtual Portfolio table (simulated paper trading balance)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS virtual_portfolio (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    balance REAL NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # 5. Virtual Trades table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS virtual_trades (
                    id SERIAL PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    ref_price REAL NOT NULL,
                    entry_price REAL NOT NULL,
                    size_usd REAL NOT NULL,
                    shares REAL NOT NULL,
                    status TEXT DEFAULT 'open', -- 'open', 'won', 'lost'
                    profit REAL DEFAULT 0.0,
                    polymarket_slug TEXT,
                    created_at TEXT NOT NULL,
                    resolved_at TEXT
                )
            """)

            # Add clob_token_id & trade_type for real trading tracking
            await conn.execute("ALTER TABLE virtual_trades ADD COLUMN IF NOT EXISTS clob_token_id TEXT")
            await conn.execute("ALTER TABLE virtual_trades ADD COLUMN IF NOT EXISTS trade_type TEXT DEFAULT 'virtual'")
            await conn.execute("ALTER TABLE virtual_trades ADD COLUMN IF NOT EXISTS post_mortem TEXT")

            # 6. Global Settings table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS global_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # 7. Portfolio History table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS portfolio_history (
                    id SERIAL PRIMARY KEY,
                    equity REAL NOT NULL,
                    balance REAL NOT NULL,
                    recorded_at TEXT NOT NULL
                )
            """)

            # Insert default tunings for watchlist symbols
            default_symbols = [
                "SPY", "PLTR", "TSLA", "NVDA", "AAPL", "AMZN", "META", "GOOGL",
                "MSFT", "NFLX", "COIN", "HOOD", "ABNB", "RKLB", "EWY", "MU", "WTI", "XAU", "XAG"
            ]
            
            from datetime import datetime
            now_str = datetime.now().isoformat()
            
            for symbol in default_symbols:
                for bt in ['open', 'close']:
                    await conn.execute("""
                        INSERT INTO parameter_tuning 
                        (symbol, bet_type, lookback_days, minutes_left_threshold, min_expected_yield, updated_at)
                        VALUES ($1, $2, 60, 60, 3.0, $3)
                        ON CONFLICT (symbol, bet_type) DO NOTHING
                    """, symbol, bt, now_str)

            # Insert defaults for portfolio & settings
            await conn.execute("""
                INSERT INTO virtual_portfolio (id, balance, updated_at)
                VALUES (1, 1000.0, $1)
                ON CONFLICT (id) DO NOTHING
            """, now_str)

            await conn.execute("""
                INSERT INTO global_settings (key, value, updated_at)
                VALUES ('risk_profile', 'MODERATE', $1)
                ON CONFLICT (key) DO NOTHING
            """, now_str)

            await conn.execute("""
                INSERT INTO global_settings (key, value, updated_at)
                VALUES ('risk_justification', 'Baslangic seviyesi: Dengeli strateji.', $1)
                ON CONFLICT (key) DO NOTHING
            """, now_str)

            # Seed initial portfolio history if empty
            history_count = await conn.fetchval("SELECT COUNT(*) FROM portfolio_history")
            if history_count == 0:
                await conn.execute("""
                    INSERT INTO portfolio_history (equity, balance, recorded_at)
                    VALUES (1000.0, 1000.0, $1)
                """, now_str)

# --- Parameter Tuning Functions ---

async def get_tuning(symbol: str, bet_type: str) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM parameter_tuning WHERE symbol = $1 AND bet_type = $2", 
            symbol.upper(), bet_type.lower()
        )
        if row:
            return dict(row)
        return {"symbol": symbol, "bet_type": bet_type, "lookback_days": 60, "minutes_left_threshold": 60, "min_expected_yield": 3.0}

async def update_tuning(symbol: str, bet_type: str, lookback_days: int, minutes_left_threshold: int, min_expected_yield: float):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO parameter_tuning 
            (symbol, bet_type, lookback_days, minutes_left_threshold, min_expected_yield, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (symbol, bet_type) DO UPDATE SET 
                lookback_days = EXCLUDED.lookback_days,
                minutes_left_threshold = EXCLUDED.minutes_left_threshold,
                min_expected_yield = EXCLUDED.min_expected_yield,
                updated_at = EXCLUDED.updated_at
        """, symbol.upper(), bet_type.lower(), lookback_days, minutes_left_threshold, min_expected_yield, now_str)

# --- Quant Signals Functions ---

async def add_signal(symbol: str, direction: str, ref_price: float, current_price: float, diff_pct: float, polymarket_slug: str, polymarket_price: float, quant_probability: float, edge_pct: float, confidence_level: str, confidence_stars: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO quant_signals 
            (symbol, direction, ref_price, current_price, diff_pct, polymarket_slug, polymarket_price, quant_probability, edge_pct, confidence_level, confidence_stars, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12)
        """, symbol.upper(), direction, ref_price, current_price, diff_pct, polymarket_slug, polymarket_price, quant_probability, edge_pct, confidence_level, confidence_stars, now_str)

async def get_active_signals():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM quant_signals WHERE status = 'active' ORDER BY created_at DESC")
        return [dict(row) for row in rows]

async def archive_all_signals():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE quant_signals SET status = 'archived' WHERE status = 'active'")

# --- Agent Logs Functions ---

async def add_agent_log(log_type: str, summary: str, details: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO agent_logs (log_type, summary, details, created_at) VALUES ($1, $2, $3, $4)",
            log_type, summary, details, now_str
        )

async def get_agent_logs(limit: int = 50):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT $1", limit)
        return [dict(row) for row in rows]

# --- Virtual Portfolio & Paper Trading Functions ---

async def get_portfolio() -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
        
        # Get settings
        risk_profile = 'MODERATE'
        risk_justification = 'Dengeli strateji.'
        rows = await conn.fetch("SELECT key, value FROM global_settings")
        for r in rows:
            if r["key"] == 'risk_profile':
                risk_profile = r["value"]
            elif r["key"] == 'risk_justification':
                risk_justification = r["value"]
                    
        # Get virtual balance
        row = await conn.fetchrow("SELECT balance FROM virtual_portfolio WHERE id = 1")
        virtual_balance = row["balance"] if row else 1000.0
        
        # Get real balance
        try:
            real_balance = await get_polymarket_usdc_balance()
        except Exception:
            real_balance = 0.0
            
        # Calculate open positions values
        virtual_open_val = 0.0
        real_open_val = 0.0
        open_trades = await conn.fetch("SELECT symbol, direction, shares, entry_price, clob_token_id, trade_type FROM virtual_trades WHERE status = 'open'")
        
        import httpx
        import asyncio
        
        async def get_best_bid(token_id):
            if not token_id:
                return None
            url = f"https://clob.polymarket.com/book?token_id={token_id}"
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url, timeout=4.0)
                    if resp.status_code == 200:
                        book = resp.json()
                        bids = book.get("bids", [])
                        if bids:
                            bids_sorted = sorted(bids, key=lambda x: float(x.get("price", 0)), reverse=True)
                            return float(bids_sorted[0]["price"])
            except Exception:
                pass
            return None

        if open_trades:
            tokens = [t["clob_token_id"] for t in open_trades]
            best_bids = await asyncio.gather(*(get_best_bid(tok) for tok in tokens))
            
            for idx, t in enumerate(open_trades):
                live_price = best_bids[idx]
                if live_price is None:
                    # Fallback to active signal price or entry price
                    sig_row = await conn.fetchrow(
                        "SELECT polymarket_price FROM quant_signals WHERE symbol = $1 AND direction = $2 AND status = 'active' LIMIT 1",
                        t["symbol"], t["direction"]
                    )
                    live_price = sig_row["polymarket_price"] if sig_row else t["entry_price"]
                
                trade_value = t["shares"] * live_price
                if t.get("trade_type") == "real":
                    real_open_val += trade_value
                else:
                    virtual_open_val += trade_value
                
        virtual_equity = virtual_balance + virtual_open_val
        real_equity = real_balance + real_open_val
        
        return {
            "trading_mode": trading_mode,
            "risk_profile": risk_profile,
            "risk_justification": risk_justification,
            "virtual": {
                "balance": virtual_balance,
                "equity": virtual_equity,
                "open_positions_value": virtual_open_val
            },
            "real": {
                "balance": real_balance,
                "equity": real_equity,
                "open_positions_value": real_open_val
            },
            # Top-level compat for backend calls
            "balance": real_balance if trading_mode == "REAL" else virtual_balance,
            "equity": real_equity if trading_mode == "REAL" else virtual_equity,
            "open_positions_value": real_open_val if trading_mode == "REAL" else virtual_open_val
        }


async def update_balance(amount: float):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE virtual_portfolio SET balance = balance + $1, updated_at = $2 WHERE id = 1", amount, now_str)

async def get_risk_profile() -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM global_settings WHERE key = 'risk_profile'")
        return row["value"] if row else "MODERATE"

async def update_risk_profile(profile: str, justification: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO global_settings (key, value, updated_at)
            VALUES ('risk_profile', $1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        """, profile, now_str)
        await conn.execute("""
            INSERT INTO global_settings (key, value, updated_at)
            VALUES ('risk_justification', $1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        """, justification, now_str)

async def open_virtual_trade(symbol: str, direction: str, ref_price: float, entry_price: float, size_usd: float, polymarket_slug: str = None, clob_token_id: str = None) -> float:
    """Opens a virtual (or real) trade if balance is sufficient. Returns actual size spent (float)."""
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
    
    async with pool.acquire() as conn:
        # Get current balance
        if trading_mode == "REAL":
            balance = await get_polymarket_usdc_balance()
        else:
            row = await conn.fetchrow("SELECT balance FROM virtual_portfolio WHERE id = 1")
            balance = row["balance"] if row else 0.0
            
        if balance < size_usd:
            logger.warning(f"Insufficient funds for trade {symbol} {direction}: Balance {balance} < {size_usd}")
            return 0.0
            
        # Check if the calculated entry price is below 0.45 (strict user limit)
        if entry_price < 0.45:
            logger.warning(f"Calculated entry price ${entry_price:.2f} is below $0.45 limit. Rejecting trade.")
            return 0.0

        # Place real or dry-run order on Polymarket
        actual_size_usd = size_usd
        actual_entry_price = entry_price
        
        if clob_token_id:
            dry_run = (trading_mode != "REAL")
            order_res = await place_polymarket_clob_order(clob_token_id, entry_price, size_usd, dry_run=dry_run)
            if not order_res.get("success"):
                logger.error(f"{'Simulated' if dry_run else 'Real'} Polymarket order failed: {order_res.get('error')}")
                return 0.0
            actual_size_usd = order_res.get("filled_size", size_usd)
            actual_entry_price = order_res.get("price", entry_price)
            
            # Check if actual executed price is below 0.45
            if actual_entry_price < 0.45:
                logger.warning(f"Actual executed price ${actual_entry_price:.2f} is below $0.45 limit. Rejecting trade.")
                return 0.0
        else:
            if trading_mode == "REAL":
                logger.error(f"Cannot place real order for {symbol} {direction} without clob_token_id!")
                return 0.0

        if trading_mode != "REAL":
            # Deduct balance (simulated)
            await conn.execute("UPDATE virtual_portfolio SET balance = balance - $1, updated_at = $2 WHERE id = 1", actual_size_usd, now_str)
        
        # Insert trade into DB
        shares = actual_size_usd / actual_entry_price
        trade_type = 'real' if trading_mode == "REAL" else 'virtual'
        await conn.execute("""
            INSERT INTO virtual_trades (symbol, direction, ref_price, entry_price, size_usd, shares, status, created_at, polymarket_slug, clob_token_id, trade_type)
            VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10)
        """, symbol.upper(), direction, ref_price, actual_entry_price, actual_size_usd, shares, now_str, polymarket_slug, clob_token_id, trade_type)
        
        return actual_size_usd


async def get_open_virtual_trades() -> list:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM virtual_trades WHERE status = 'open' ORDER BY created_at DESC")
        return [dict(row) for row in rows]

async def resolve_virtual_trade(trade_id: int, status: str, payout_per_share: float):
    """Resolves a trade ('won' or 'lost'), credits payout to balance, updates profit."""
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Get trade info
        trade = await conn.fetchrow("SELECT * FROM virtual_trades WHERE id = $1", trade_id)
        if not trade:
            return
                
        shares = trade["shares"]
        size_usd = trade["size_usd"]
        payout = shares * payout_per_share
        profit = payout - size_usd
        
        # Credit balance
        await conn.execute("UPDATE virtual_portfolio SET balance = balance + $1, updated_at = $2 WHERE id = 1", payout, now_str)
        
        # Update trade
        await conn.execute("""
            UPDATE virtual_trades 
            SET status = $1, profit = $2, resolved_at = $3
            WHERE id = $4
        """, status, profit, now_str, trade_id)

async def get_virtual_trades(limit: int = 50) -> list:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM virtual_trades ORDER BY created_at DESC LIMIT $1", limit)
        return [dict(row) for row in rows]

async def get_recent_performance(limit: int = 10) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM virtual_trades 
            WHERE status IN ('won', 'lost') 
            ORDER BY resolved_at DESC 
            LIMIT $1
        """, limit)
            
        trades = [dict(row) for row in rows]
        total_trades = len(trades)
        if total_trades == 0:
            return {"win_rate": 0.0, "total_profit": 0.0, "total_trades": 0}
            
        win_count = sum(1 for t in trades if t["status"] == "won")
        total_profit = sum(t["profit"] for t in trades)
        win_rate = (win_count / total_trades) * 100
        
        return {
            "win_rate": win_rate,
            "total_profit": total_profit,
            "total_trades": total_trades
        }

async def record_portfolio_history():
    """Calculates current equity/balance and records it in history table."""
    port = await get_portfolio()
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO portfolio_history (equity, balance, recorded_at) VALUES ($1, $2, $3)",
            port["equity"], port["balance"], now_str
        )

async def get_polymarket_usdc_balance() -> float:
    """Fetches live USDC balance of the connected wallet address from Polymarket CLOB (or Polygon RPC fallback)."""
    private_key = os.getenv("POLYMARKET_PRIVATE_KEY")
    wallet_address = os.getenv("POLYMARKET_WALLET_ADDRESS")
    sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "1"))
    
    if private_key:
        try:
            from py_clob_client_v2.client import ClobClient
            from py_clob_client_v2 import BalanceAllowanceParams, AssetType
            
            client = ClobClient(
                host="https://clob.polymarket.com",
                key=private_key,
                chain_id=137,
                signature_type=sig_type,
                funder=wallet_address
            )
            # Auto-derive L2 credentials if needed
            api_key = os.getenv("POLYMARKET_API_KEY")
            api_secret = os.getenv("POLYMARKET_API_SECRET")
            api_passphrase = os.getenv("POLYMARKET_API_PASSPHRASE")
            
            if not (api_key and api_secret and api_passphrase):
                client.set_api_creds(client.create_or_derive_api_key())
            else:
                from py_clob_client_v2 import ApiCreds
                creds = ApiCreds(api_key=api_key, secret=api_secret, passphrase=api_passphrase)
                client.set_api_creds(creds)
                
            params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL)
            res = client.get_balance_allowance(params)
            
            balance = 0.0
            if isinstance(res, dict):
                balance = float(res.get("balance", 0.0))
            else:
                balance = float(getattr(res, "balance", 0.0))
            return balance
        except Exception as e:
            logger.error(f"Failed to fetch balance from CLOB API: {e}. Falling back to RPC...")
            
    # Fallback to RPC USDC balance of MetaMask wallet address
    if not wallet_address:
        return 0.0
        
    url = "https://polygon-rpc.com/"
    usdc_contract = "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb" # Polymarket USD (pUSD) contract address
    clean_address = wallet_address.lower().replace("0x", "")
    data = "0x70a08231" + clean_address.zfill(64)
    
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [
            {"to": usdc_contract, "data": data},
            "latest"
        ],
        "id": 1
    }
    
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=8.0)
            if resp.status_code == 200:
                result = resp.json().get("result")
                if result and result != "0x":
                    balance_int = int(result, 16)
                    return balance_int / 1000000.0 # USDC has 6 decimals
    except Exception as e:
        logger.error(f"Error fetching RPC balance: {e}")
        
    return 0.0

async def place_polymarket_clob_order(token_id: str, price: float, size_usd: float, dry_run: bool = False) -> dict:
    """Places a taker buy order on Polymarket CLOB by matching the best ask price/size immediately in a loop."""
    private_key = os.getenv("POLYMARKET_PRIVATE_KEY")
    wallet_address = os.getenv("POLYMARKET_WALLET_ADDRESS")
    api_key = os.getenv("POLYMARKET_API_KEY")
    api_secret = os.getenv("POLYMARKET_API_SECRET")
    api_passphrase = os.getenv("POLYMARKET_API_PASSPHRASE")
    sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "1"))
    
    if not dry_run:
        if not private_key:
            logger.error("Polymarket cüzdan Private Key eksik!")
            return {"success": False, "error": "Private Key missing"}
        auto_derive = not (api_key and api_secret and api_passphrase)

    client = None
    if not dry_run:
        try:
            from py_clob_client_v2.client import ClobClient
            
            # MONKEY PATCH: Force SDK L1 Headers to use Deposit Wallet address (wallet_address)
            # instead of EOA address, so the API key binds directly to the deposit wallet.
            import py_clob_client_v2.headers.headers as sdk_headers
            original_create_level_1_headers = sdk_headers.create_level_1_headers
            
            def patched_create_level_1_headers(signer, timestamp, nonce=0, custom_address=None):
                # Call original but pass the deposit wallet (funder) address as the signer address
                headers = original_create_level_1_headers(signer, timestamp, nonce)
                # Override the address in the L1 headers with the deposit wallet address
                headers["POLY_ADDRESS"] = wallet_address
                logger.info(f"Monkey patched L1 headers POLY_ADDRESS to deposit wallet: {wallet_address}")
                return headers
                
            sdk_headers.create_level_1_headers = patched_create_level_1_headers
            
            if auto_derive:
                logger.info("Polymarket CLOB L2 API credentials not provided. Deriving them automatically from Private Key...")
                client = ClobClient(
                    host="https://clob.polymarket.com",
                    key=private_key,
                    chain_id=137,
                    signature_type=sig_type,
                    funder=wallet_address
                )
                client.set_api_creds(client.create_or_derive_api_key())
            else:
                from py_clob_client_v2 import ApiCreds
                creds = ApiCreds(
                    api_key=api_key,
                    secret=api_secret,
                    passphrase=api_passphrase
                )
                client = ClobClient(
                    host="https://clob.polymarket.com",
                    key=private_key,
                    chain_id=137,
                    creds=creds,
                    signature_type=sig_type,
                    funder=wallet_address
                )
        except Exception as e:
            logger.error(f"Failed to initialize ClobClient: {e}")
            return {"success": False, "error": f"Client init failed: {e}"}

    import asyncio
    import httpx
    
    remaining_size_usd = size_usd
    total_filled_usd = 0.0
    execution_prices = []
    filled_sizes = []
    max_attempts = 5
    attempt = 0
    url = f"https://clob.polymarket.com/book?token_id={token_id}"
    last_error = "No attempts made"

    while remaining_size_usd >= 2.0 and attempt < max_attempts:
        attempt += 1
        try:
            # Fetch fresh orderbook asks
            async with httpx.AsyncClient() as client_http:
                resp = await client_http.get(url, timeout=6.0)
                if resp.status_code != 200:
                    last_error = f"Failed to fetch orderbook: status {resp.status_code}"
                    logger.error(f"Failed to fetch orderbook on attempt {attempt}: status {resp.status_code}")
                    break
                book = resp.json()
                asks = book.get("asks", [])
                asks = sorted(asks, key=lambda x: float(x.get("price") if isinstance(x, dict) else getattr(x, "price")))
        except Exception as ob_err:
            last_error = f"Failed to query orderbook: {ob_err}"
            logger.error(f"Failed to query orderbook depth on attempt {attempt}: {ob_err}")
            break

        if not asks:
            last_error = "No asks available in orderbook"
            logger.warning(f"No asks available in orderbook on attempt {attempt}")
            break

        # Get the best ask
        best_ask = asks[0]
        ask_p = float(best_ask.get("price") if isinstance(best_ask, dict) else getattr(best_ask, "price"))
        ask_sz = float(best_ask.get("size") if isinstance(best_ask, dict) else getattr(best_ask, "size"))

        # Check price safety rules:
        # 1. Under no circumstances buy contracts below 45c (0.45)
        if ask_p < 0.45:
            last_error = f"Best ask price ${ask_p:.2f} is below $0.45 limit"
            logger.warning(f"Best ask price ${ask_p:.2f} is below $0.45 limit. Rejecting order on attempt {attempt}.")
            break

        # 2. Check upward slippage: limit order at best ask shouldn't exceed 2% of calculated entry price
        if ask_p > price * 1.02:
            last_error = f"Best ask price ${ask_p:.2f} exceeds 2% slippage limit of calculated price ${price:.2f}"
            logger.warning(f"Best ask price ${ask_p:.2f} exceeds 2% slippage limit of calculated price ${price:.2f} on attempt {attempt}.")
            break

        # 3. Check downward mismatch: if ask price is over 5% lower than expected, reject due to stale data/wrong token mapping
        if ask_p < price * 0.95:
            last_error = f"Best ask price ${ask_p:.2f} is more than 5% below calculated price ${price:.2f}"
            logger.warning(f"Best ask price ${ask_p:.2f} is more than 5% below calculated price ${price:.2f} (likely stale data or wrong token mapping). Rejecting on attempt {attempt}.")
            break

        available_usd = ask_sz * ask_p
        fill_size_usd = min(remaining_size_usd, available_usd)

        # Scale down to what is available. If less than $2.0, we cannot place the order.
        if fill_size_usd < 2.0:
            last_error = f"Scaled size ${fill_size_usd:.2f} below CLOB minimum $2.0 (Available depth: ${available_usd:.2f})"
            logger.warning(f"Taker order attempt {attempt} scaled size ${fill_size_usd:.2f} below CLOB minimum $2.0 (Available depth: ${available_usd:.2f})")
            break

        if dry_run:
            logger.info(f"CLOB Taker Order Loop (DRY RUN) Attempt {attempt}: Simulated fill of ${fill_size_usd:.2f} at price ${ask_p:.2f}")
            total_filled_usd += fill_size_usd
            remaining_size_usd -= fill_size_usd
            execution_prices.append(ask_p)
            filled_sizes.append(fill_size_usd)
            if remaining_size_usd < 2.0:
                break
            await asyncio.sleep(0.5) # short delay in dry-run simulation
            continue

        # Real order placement
        try:
            from py_clob_client_v2 import OrderArgsV2
            shares = fill_size_usd / ask_p
            
            resp_order = client.create_and_post_order(
                order_args=OrderArgsV2(
                    token_id=token_id,
                    price=round(ask_p, 2),
                    side="BUY",
                    size=round(shares, 4)
                )
            )
            
            if resp_order and isinstance(resp_order, dict) and resp_order.get("success"):
                logger.info(f"CLOB Taker Order Loop Attempt {attempt} Successful: Filled ${fill_size_usd:.2f} at price ${ask_p:.2f}")
                total_filled_usd += fill_size_usd
                remaining_size_usd -= fill_size_usd
                execution_prices.append(ask_p)
                filled_sizes.append(fill_size_usd)
            else:
                last_error = f"CLOB order placement failed: {resp_order}"
                logger.error(f"CLOB order placement failed on attempt {attempt}: {resp_order}")
                break
        except Exception as e:
            last_error = f"Exception during order placement: {str(e)}"
            logger.error(f"Exception during CLOB order placement on attempt {attempt}: {e}")
            break

        if remaining_size_usd >= 2.0:
            logger.info(f"Waiting 2.5 seconds for liquidity replenishment... (Remaining to buy: ${remaining_size_usd:.2f})")
            await asyncio.sleep(2.5)

    if total_filled_usd > 0.0:
        avg_price = sum(p * s for p, s in zip(execution_prices, filled_sizes)) / total_filled_usd
        return {"success": True, "filled_size": total_filled_usd, "price": avg_price}
    else:
        return {"success": False, "error": last_error}


async def update_trade_post_mortem(trade_id: int, post_mortem: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE virtual_trades SET post_mortem = $1 WHERE id = $2", post_mortem, trade_id)


async def get_recent_resolved_trades_with_feedback(symbol: str = None, limit: int = 5) -> list:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if symbol:
            rows = await conn.fetch(
                "SELECT * FROM virtual_trades WHERE status IN ('won', 'lost') AND symbol = $1 AND post_mortem IS NOT NULL ORDER BY resolved_at DESC LIMIT $2",
                symbol.upper(), limit
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM virtual_trades WHERE status IN ('won', 'lost') AND post_mortem IS NOT NULL ORDER BY resolved_at DESC LIMIT $1",
                limit
            )
        return [dict(row) for row in rows]


async def get_setting(key: str) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM global_settings WHERE key = $1", key)
        return row["value"] if row else None


async def update_setting(key: str, value: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO global_settings (key, value, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        """, key, value, now_str)
