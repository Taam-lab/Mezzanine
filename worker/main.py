"""
Mezzanine Watch - Python Worker
역할: OpenDART 공시 폴링, 주가 데이터 수집, 전환가 조정 자동 반영
배포: Railway 또는 Render (별도 서비스)
"""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from jobs.poll_disclosures import poll_disclosures
from jobs.poll_prices import poll_prices_realtime, daily_price_close

load_dotenv()

POLLING_INTERVAL = int(os.getenv("POLLING_INTERVAL", "5"))

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 스케줄러 시작
    scheduler.add_job(poll_disclosures, "interval", minutes=POLLING_INTERVAL, id="poll_disclosures")
    scheduler.add_job(poll_prices_realtime, "interval", minutes=POLLING_INTERVAL, id="poll_prices")
    scheduler.add_job(daily_price_close, "cron", hour=16, minute=30, id="daily_close")
    scheduler.start()
    print(f"[Worker] 스케줄러 시작 — 폴링 주기: {POLLING_INTERVAL}분")
    yield
    scheduler.shutdown()


app = FastAPI(title="Mezz Watch Worker", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "jobs": [job.id for job in scheduler.get_jobs()]}


@app.post("/trigger/disclosures")
async def trigger_disclosures():
    await poll_disclosures()
    return {"ok": True}


@app.post("/trigger/prices")
async def trigger_prices():
    await poll_prices_realtime()
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
