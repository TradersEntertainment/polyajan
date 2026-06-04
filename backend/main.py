from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import os
import database
import pyth_client
import agent_coordinator

app = FastAPI(title="Poly AI Quant Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    await database.init_db()
    await pyth_client.init_feeds_cache()
    
    # Start the autonomous AI Agent loop
    agent_coordinator.start_agent_task()

@app.get("/api/signals")
async def get_signals():
    try:
        return await database.get_active_signals()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs")
async def get_logs():
    try:
        return await database.get_agent_logs(limit=40)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tunings")
async def get_tunings():
    try:
        pool = await database.get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM parameter_tuning ORDER BY symbol ASC")
            return [dict(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/scan-now")
async def run_scan_now():
    try:
        await agent_coordinator.run_autonomous_scan_cycle()
        return {"message": "Tarama başarıyla gerçekleştirildi."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/portfolio")
async def get_portfolio_status():
    try:
        return await database.get_portfolio()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/test-clob")
async def test_clob_connection():
    try:
        import os
        from py_clob_client_v2.client import ClobClient
        
        private_key = os.getenv("POLYMARKET_PRIVATE_KEY")
        wallet_address = os.getenv("POLYMARKET_WALLET_ADDRESS")
        sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "1"))
        
        if not private_key:
            return {"status": "error", "message": "POLYMARKET_PRIVATE_KEY is not set in environment."}
            
        rpc_balance = await database.get_polymarket_usdc_balance()
        
        try:
            client = ClobClient(
                host="https://clob.polymarket.com",
                key=private_key,
                chain_id=137,
                signature_type=sig_type,
                funder=wallet_address
            )
            creds = client.create_or_derive_api_key()
            client.set_api_creds(creds)
            
            return {
                "status": "success",
                "wallet_address": wallet_address,
                "usdc_balance_rpc": rpc_balance,
                "clob_authentication": "successful",
                "derived_api_key": creds.api_key if hasattr(creds, 'api_key') else getattr(creds, 'key', 'derived'),
                "message": "Polymarket CLOB API connection is fully working and authenticated!"
            }
        except Exception as clob_err:
            return {
                "status": "error",
                "wallet_address": wallet_address,
                "usdc_balance_rpc": rpc_balance,
                "clob_authentication": "failed",
                "error_details": str(clob_err),
                "message": "Failed to connect/authenticate with Polymarket CLOB. Check private key and signature type."
            }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/test-trade")
async def test_real_trade():
    try:
        import os
        
        private_key = os.getenv("POLYMARKET_PRIVATE_KEY")
        wallet_address = os.getenv("POLYMARKET_WALLET_ADDRESS")
        
        if not private_key:
            return {"status": "error", "message": "POLYMARKET_PRIVATE_KEY is not set in environment."}
            
        # Try dynamic search for SPY UP (YES) token first
        token_id = "42042588017216294761306663077196918419483534904371512376840641152317874042985"
        price_limit = 0.99
        market_title = "S&P 500 (SPY) closes above $755 on June 5? (Fallback)"
        
        try:
            from agent_coordinator import fetch_active_polymarket_markets
            active_markets = await fetch_active_polymarket_markets()
            
            spy_up_markets = [
                m for m in active_markets 
                if m.get("symbol") == "SPY" and m.get("up_token_id") and 0.45 <= m.get("up_price", 0.0) < 0.95
            ]
            
            if spy_up_markets:
                # Select the first one
                selected_market = spy_up_markets[0]
                token_id = selected_market["up_token_id"]
                price_limit = selected_market["up_price"]
                market_title = selected_market["title"]
        except Exception as scan_err:
            # Fallback to defaults
            pass
            
        # Fetch the actual best ask from the orderbook to align price_limit and avoid mismatch rejections
        try:
            import httpx
            book_url = f"https://clob.polymarket.com/book?token_id={token_id}"
            async with httpx.AsyncClient() as hc:
                book_resp = await hc.get(book_url, timeout=6.0)
                if book_resp.status_code == 200:
                    book_data = book_resp.json()
                    asks = book_data.get("asks", [])
                    if asks:
                        asks_sorted = sorted(asks, key=lambda x: float(x.get("price") if isinstance(x, dict) else getattr(x, "price")))
                        best_ask_price = float(asks_sorted[0]["price"] if isinstance(asks_sorted[0], dict) else getattr(asks_sorted[0], "price"))
                        price_limit = best_ask_price
                        market_title = f"{market_title} (Orderbook Price Aligned to ${price_limit:.2f})"
        except Exception as p_err:
            pass

        size_usd = 5.0
        res = await database.place_polymarket_clob_order(
            token_id=token_id,
            price=price_limit,
            size_usd=size_usd,
            dry_run=False
        )
        
        return {
            "status": "success" if res.get("success") else "error",
            "wallet_address": wallet_address,
            "target_market": market_title,
            "token_id": token_id,
            "order_result": res,
            "message": "Attempted to execute a $5 SPY UP buy trade on Polymarket CLOB."
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/trades/virtual")
async def get_virtual_trades():
    try:
        trades = await database.get_virtual_trades()
        
        # Inject live best bid price for open positions
        import asyncio
        import httpx
        
        async def populate_live_price(t):
            if t["status"] == "open" and t.get("clob_token_id"):
                token_id = t["clob_token_id"]
                url = f"https://clob.polymarket.com/book?token_id={token_id}"
                try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(url, timeout=6.0)
                        if resp.status_code == 200:
                            book = resp.json()
                            bids = book.get("bids", [])
                            if bids:
                                bids_sorted = sorted(bids, key=lambda x: float(x.get("price", 0)), reverse=True)
                                t["current_price"] = float(bids_sorted[0]["price"])
                except Exception:
                    pass
                    
        open_trades = [t for t in trades if t["status"] == "open"]
        if open_trades:
            await asyncio.gather(*(populate_live_price(t) for t in open_trades))
            
        return trades
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trades/{trade_id}/close")
async def close_trade(trade_id: int):
    try:
        result = await database.close_trade_position(trade_id)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "Pozisyon kapatılamadı."))

        # Send Telegram notification about the close
        try:
            telegram_token = os.getenv("TELEGRAM_TOKEN")
            chat_id = os.getenv("CHAT_ID")
            if telegram_token and chat_id:
                import httpx
                profit = result.get("profit", 0)
                emoji = "💰" if profit >= 0 else "📉"
                partial_tag = " (Kısmi)" if result.get("partial") else ""
                msg = (
                    f"{emoji} <b>Pozisyon Manuel Kapatıldı{partial_tag}</b>\n\n"
                    f"• Satılan Pay: {result.get('sold_shares', 0):.2f}\n"
                    f"• Ort. Satış Fiyatı: ${result.get('avg_sell_price', 0):.2f}\n"
                    f"• Toplam Gelir: ${result.get('proceeds', 0):.2f}\n"
                    f"• Kâr/Zarar: <b>${profit:+.2f}</b>\n\n"
                    f"📝 {result.get('message', '')}"
                )
                url = f"https://api.telegram.org/bot{telegram_token}/sendMessage"
                async with httpx.AsyncClient() as hc:
                    await hc.post(url, json={"chat_id": chat_id, "text": msg, "parse_mode": "HTML"}, timeout=5.0)
        except Exception:
            pass  # Don't fail the response if Telegram fails

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/portfolio/history")
async def get_portfolio_history():
    try:
        pool = await database.get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT equity, balance, recorded_at FROM portfolio_history ORDER BY recorded_at ASC LIMIT 100")
            return [dict(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/reset-portfolio")
async def reset_portfolio():
    try:
        pool = await database.get_pool()
        from datetime import datetime
        now_str = datetime.now().isoformat()
        
        # Get appropriate initial balance based on mode
        trading_mode = os.getenv("TRADING_MODE", "VIRTUAL").upper()
        if trading_mode == "REAL":
            init_balance = await database.get_polymarket_usdc_balance()
        else:
            init_balance = 1000.0
            
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM virtual_trades")
                await conn.execute("UPDATE virtual_portfolio SET balance = $1 WHERE id = 1", init_balance)
                await conn.execute("DELETE FROM portfolio_history")
                await conn.execute("INSERT INTO portfolio_history (equity, balance, recorded_at) VALUES ($1, $1, $2)", init_balance, now_str)
                await conn.execute("UPDATE global_settings SET value = 'MODERATE' WHERE key = 'risk_profile'")
                await conn.execute("UPDATE global_settings SET value = 'Baslangic seviyesi: Dengeli strateji.' WHERE key = 'risk_justification'")
        return {"message": f"{'Gerçek' if trading_mode == 'REAL' else 'Sanal'} portföy başarıyla sıfırlandı, tüm işlemler temizlendi."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Serve Frontend Static Files ---
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))

@app.exception_handler(404)
async def not_found_exception_handler(request, exc):
    # API endpoints should return a standard JSON 404
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    # React SPA routing fallback
    index_path = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=404, content={"detail": "Not Found"})

# Mount the static files at root
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
