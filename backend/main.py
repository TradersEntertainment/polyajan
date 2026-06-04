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

@app.get("/api/trades/virtual")
async def get_virtual_trades():
    try:
        return await database.get_virtual_trades()
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
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM virtual_trades")
                await conn.execute("UPDATE virtual_portfolio SET balance = 1000.0 WHERE id = 1")
                await conn.execute("DELETE FROM portfolio_history")
                await conn.execute("INSERT INTO portfolio_history (equity, balance, recorded_at) VALUES (1000.0, 1000.0, $1)", now_str)
                await conn.execute("UPDATE global_settings SET value = 'MODERATE' WHERE key = 'risk_profile'")
                await conn.execute("UPDATE global_settings SET value = 'Baslangic seviyesi: Dengeli strateji.' WHERE key = 'risk_justification'")
        return {"message": "Sanal portfoy basariyla sifirlandi, tum islemler temizlendi."}
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
