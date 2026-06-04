import asyncio
import os
import sys

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

import database

async def main():
    print("--- POSTGRESQL PAPER TRADING TEST ---")
    
    # Check if DATABASE_URL is set
    url = os.getenv("DATABASE_URL")
    if not url:
        # Try loading .env just in case
        from dotenv import load_dotenv
        load_dotenv()
        url = os.getenv("DATABASE_URL")
        
    if not url:
        print("[!] ERROR: DATABASE_URL environment variable is not set!")
        print("Please configure a PostgreSQL connection string to run this validation.")
        return
        
    # 1. Initialize DB
    await database.init_db()
    print("[1] PostgreSQL Database initialized.")
    
    # Reset tables for testing
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM virtual_trades")
        await conn.execute("UPDATE virtual_portfolio SET balance = 1000.0 WHERE id = 1")
        await conn.execute("UPDATE global_settings SET value = 'MODERATE' WHERE key = 'risk_profile'")
    print("[2] Test database reset: Balance set to $1000.00.")

    # 3. Get Initial Portfolio
    p = await database.get_portfolio()
    print(f"[3] Initial Portfolio -> Balance: ${p['balance']:.2f}, Equity: ${p['equity']:.2f}, Open Value: ${p['open_positions_value']:.2f}, Risk: {p['risk_profile']}")
    assert abs(p['balance'] - 1000.0) < 0.01
    assert abs(p['equity'] - 1000.0) < 0.01
    assert abs(p['open_positions_value'] - 0.0) < 0.01

    # 4. Open Trade: PLTR OPEN_UP, Entry at $0.65, size $100
    success = await database.open_virtual_trade(
        symbol="PLTR",
        direction="OPEN_UP",
        ref_price=25.00,
        entry_price=0.65,
        size_usd=100.00,
        polymarket_slug="pltr-opens-up-on-june-5"
    )
    print(f"[4] Open virtual trade: {success}")
    assert success is True

    # 5. Check Portfolio after Opening Position
    p = await database.get_portfolio()
    print(f"[5] After Open Position -> Balance: ${p['balance']:.2f}, Equity: ${p['equity']:.2f}, Open Value: ${p['open_positions_value']:.2f}")
    assert abs(p['balance'] - 900.0) < 0.01
    assert abs(p['equity'] - 1000.0) < 0.01
    assert abs(p['open_positions_value'] - 100.0) < 0.01

    # 6. Fetch Open Trades
    open_trades = await database.get_open_virtual_trades()
    print(f"[6] Open Trades count: {len(open_trades)}")
    assert len(open_trades) == 1
    t = open_trades[0]
    print(f"    Open Trade -> Symbol: {t['symbol']}, Dir: {t['direction']}, Shares: {t['shares']:.2f}, Size: ${t['size_usd']:.2f}")

    # 7. Resolve Trade as WON (Payout $1.00 per share)
    trade_id = t["id"]
    await database.resolve_virtual_trade(trade_id, status="won", payout_per_share=1.00)
    print(f"[7] Trade resolved as WON.")

    # 8. Check Portfolio after resolution
    p = await database.get_portfolio()
    expected_payout = (100.00 / 0.65) * 1.00
    expected_balance = 900.00 + expected_payout
    print(f"[8] After Resolution -> Balance: ${p['balance']:.2f}, Equity: ${p['equity']:.2f}, Open Value: ${p['open_positions_value']:.2f}")
    assert abs(p['balance'] - expected_balance) < 0.01
    assert abs(p['equity'] - expected_balance) < 0.01
    assert abs(p['open_positions_value'] - 0.0) < 0.01

    # 9. Get Recent Performance
    perf = await database.get_recent_performance()
    print(f"[9] Performance Summary -> Total profit: ${perf['total_profit']:.2f}, Win Rate: {perf['win_rate']:.1f}%")
    assert perf['win_rate'] == 100.0
    assert abs(perf['total_profit'] - (expected_payout - 100.00)) < 0.01

    print("\n--- ALL POSTGRESQL TESTS PASSED SUCCESSFULLY! ---")

if __name__ == "__main__":
    asyncio.run(main())
