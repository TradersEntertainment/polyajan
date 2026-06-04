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
