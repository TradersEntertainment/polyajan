from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
        async with database.aiosqlite.connect(database.DB_FILE) as db:
            db.row_factory = database.aiosqlite.Row
            async with db.execute("SELECT * FROM parameter_tuning ORDER BY symbol ASC") as cursor:
                rows = await cursor.fetchall()
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
