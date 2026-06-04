import aiosqlite
import logging

logger = logging.getLogger(__name__)

DB_FILE = "quant_agent.db"

async def init_db():
    async with aiosqlite.connect(DB_FILE) as db:
        # 1. Parameter Tuning table (updated by the LLM agent coordinator)
        await db.execute("""
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

        # Insert default tunings for watchlist symbols
        default_symbols = [
            "SPY", "PLTR", "TSLA", "NVDA", "AAPL", "AMZN", "META", "GOOGL",
            "MSFT", "NFLX", "COIN", "HOOD", "ABNB", "RKLB", "EWY", "MU", "WTI", "XAU", "XAG"
        ]
        
        import time
        from datetime import datetime
        now_str = datetime.now().isoformat()
        
        for symbol in default_symbols:
            for bt in ['open', 'close']:
                await db.execute("""
                    INSERT OR IGNORE INTO parameter_tuning 
                    (symbol, bet_type, lookback_days, minutes_left_threshold, min_expected_yield, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (symbol, bt, 60, 60, 3.0, now_str))

        # 2. Quant Signals table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS quant_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_type TEXT NOT NULL, -- 'Tuning', 'Decision', 'Info'
                summary TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        # 4. Virtual Portfolio table (simulated paper trading balance)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS virtual_portfolio (
                id INTEGER PRIMARY KEY DEFAULT 1,
                balance REAL NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # 5. Virtual Trades table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS virtual_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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

        # 6. Global Settings table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Insert defaults for portfolio & settings
        await db.execute("""
            INSERT OR IGNORE INTO virtual_portfolio (id, balance, updated_at)
            VALUES (1, 1000.0, ?)
        """, (now_str,))

        await db.execute("""
            INSERT OR IGNORE INTO global_settings (key, value, updated_at)
            VALUES ('risk_profile', 'MODERATE', ?)
        """, (now_str,))

        await db.execute("""
            INSERT OR IGNORE INTO global_settings (key, value, updated_at)
            VALUES ('risk_justification', 'Baslangic seviyesi: Dengeli strateji.', ?)
        """, (now_str,))

        await db.commit()

# --- Parameter Tuning Functions ---

async def get_tuning(symbol: str, bet_type: str) -> dict:
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM parameter_tuning WHERE symbol = ? AND bet_type = ?", 
            (symbol.upper(), bet_type.lower())
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return {"symbol": symbol, "bet_type": bet_type, "lookback_days": 60, "minutes_left_threshold": 60, "min_expected_yield": 3.0}

async def update_tuning(symbol: str, bet_type: str, lookback_days: int, minutes_left_threshold: int, min_expected_yield: float):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("""
            INSERT OR REPLACE INTO parameter_tuning 
            (symbol, bet_type, lookback_days, minutes_left_threshold, min_expected_yield, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (symbol.upper(), bet_type.lower(), lookback_days, minutes_left_threshold, min_expected_yield, now_str))
        await db.commit()

# --- Quant Signals Functions ---

async def add_signal(symbol: str, direction: str, ref_price: float, current_price: float, diff_pct: float, polymarket_slug: str, polymarket_price: float, quant_probability: float, edge_pct: float, confidence_level: str, confidence_stars: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("""
            INSERT INTO quant_signals 
            (symbol, direction, ref_price, current_price, diff_pct, polymarket_slug, polymarket_price, quant_probability, edge_pct, confidence_level, confidence_stars, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        """, (symbol.upper(), direction, ref_price, current_price, diff_pct, polymarket_slug, polymarket_price, quant_probability, edge_pct, confidence_level, confidence_stars, now_str))
        await db.commit()

async def get_active_signals():
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM quant_signals WHERE status = 'active' ORDER BY created_at DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def archive_all_signals():
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("UPDATE quant_signals SET status = 'archived' WHERE status = 'active'")
        await db.commit()

# --- Agent Logs Functions ---

async def add_agent_log(log_type: str, summary: str, details: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            "INSERT INTO agent_logs (log_type, summary, details, created_at) VALUES (?, ?, ?, ?)",
            (log_type, summary, details, now_str)
        )
        await db.commit()

async def get_agent_logs(limit: int = 50):
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

# --- Virtual Portfolio & Paper Trading Functions ---

async def get_portfolio() -> dict:
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        # Get balance
        async with db.execute("SELECT balance FROM virtual_portfolio WHERE id = 1") as cursor:
            row = await cursor.fetchone()
            balance = row["balance"] if row else 1000.0
            
        # Get settings
        risk_profile = 'MODERATE'
        risk_justification = 'Dengeli strateji.'
        async with db.execute("SELECT key, value FROM global_settings") as cursor:
            rows = await cursor.fetchall()
            for r in rows:
                if r["key"] == 'risk_profile':
                    risk_profile = r["value"]
                elif r["key"] == 'risk_justification':
                    risk_justification = r["value"]
                    
        # Calculate open positions value
        open_positions_value = 0.0
        async with db.execute("SELECT symbol, direction, shares, entry_price FROM virtual_trades WHERE status = 'open'") as cursor:
            open_trades = await cursor.fetchall()
            for t in open_trades:
                async with db.execute(
                    "SELECT polymarket_price FROM quant_signals WHERE symbol = ? AND direction = ? AND status = 'active' LIMIT 1",
                    (t["symbol"], t["direction"])
                ) as sig_cursor:
                    sig_row = await sig_cursor.fetchone()
                    live_prob = sig_row["polymarket_price"] if sig_row else t["entry_price"]
                open_positions_value += t["shares"] * live_prob
                
        equity = balance + open_positions_value
        return {
            "balance": balance,
            "equity": equity,
            "open_positions_value": open_positions_value,
            "risk_profile": risk_profile,
            "risk_justification": risk_justification
        }

async def update_balance(amount: float):
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("UPDATE virtual_portfolio SET balance = balance + ?, updated_at = datetime('now') WHERE id = 1", (amount,))
        await db.commit()

async def get_risk_profile() -> str:
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT value FROM global_settings WHERE key = 'risk_profile'") as cursor:
            row = await cursor.fetchone()
            return row["value"] if row else "MODERATE"

async def update_risk_profile(profile: str, justification: str):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("""
            INSERT OR REPLACE INTO global_settings (key, value, updated_at)
            VALUES ('risk_profile', ?, ?)
        """, (profile, now_str))
        await db.execute("""
            INSERT OR REPLACE INTO global_settings (key, value, updated_at)
            VALUES ('risk_justification', ?, ?)
        """, (justification, now_str))
        await db.commit()

async def open_virtual_trade(symbol: str, direction: str, ref_price: float, entry_price: float, size_usd: float, polymarket_slug: str = None) -> bool:
    """Opens a virtual trade if balance is sufficient."""
    from datetime import datetime
    now_str = datetime.now().isoformat()
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        # Get current balance
        async with db.execute("SELECT balance FROM virtual_portfolio WHERE id = 1") as cursor:
            row = await cursor.fetchone()
            balance = row["balance"] if row else 0.0
            
        if balance < size_usd:
            return False
            
        # Deduct balance
        await db.execute("UPDATE virtual_portfolio SET balance = balance - ?, updated_at = ? WHERE id = 1", (size_usd, now_str))
        
        # Insert trade
        shares = size_usd / entry_price
        await db.execute("""
            INSERT INTO virtual_trades (symbol, direction, ref_price, entry_price, size_usd, shares, status, created_at, polymarket_slug)
            VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
        """, (symbol.upper(), direction, ref_price, entry_price, size_usd, shares, now_str, polymarket_slug))
        
        await db.commit()
        return True

async def get_open_virtual_trades() -> list:
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM virtual_trades WHERE status = 'open' ORDER BY created_at DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def resolve_virtual_trade(trade_id: int, status: str, payout_per_share: float):
    """Resolves a trade ('won' or 'lost'), credits payout to balance, updates profit."""
    from datetime import datetime
    now_str = datetime.now().isoformat()
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        # Get trade info
        async with db.execute("SELECT * FROM virtual_trades WHERE id = ?", (trade_id,)) as cursor:
            trade = await cursor.fetchone()
            if not trade:
                return
                
        shares = trade["shares"]
        size_usd = trade["size_usd"]
        payout = shares * payout_per_share
        profit = payout - size_usd
        
        # Credit balance
        await db.execute("UPDATE virtual_portfolio SET balance = balance + ?, updated_at = ? WHERE id = 1", (payout, now_str))
        
        # Update trade
        await db.execute("""
            UPDATE virtual_trades 
            SET status = ?, profit = ?, resolved_at = ?
            WHERE id = ?
        """, (status, profit, now_str, trade_id))
        
        await db.commit()

async def get_virtual_trades(limit: int = 50) -> list:
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM virtual_trades ORDER BY created_at DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def get_recent_performance(limit: int = 10) -> dict:
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT * FROM virtual_trades 
            WHERE status IN ('won', 'lost') 
            ORDER BY resolved_at DESC 
            LIMIT ?
        """, (limit,)) as cursor:
            rows = await cursor.fetchall()
            
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
