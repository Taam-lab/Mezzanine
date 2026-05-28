"""
주가 데이터 폴링 Job
- pykrx: 일봉 데이터 (장 마감 후)
- 네이버 금융 스크래핑: 장중 현재가
- 한국투자증권 API: 키 등록 시 자동 전환 (Phase 2)
"""

import os
import asyncio
import httpx
from datetime import datetime, date
from sqlalchemy import text

from db import AsyncSessionLocal

PRICE_CHANGE_THRESHOLD = float(os.getenv("PRICE_CHANGE_THRESHOLD", "10.0"))


async def get_price_threshold(session) -> float:
    result = await session.execute(
        text("SELECT value FROM system_settings WHERE key = 'price_change_threshold'")
    )
    row = result.fetchone()
    if row:
        try:
            return float(row[0])
        except ValueError:
            pass
    return PRICE_CHANGE_THRESHOLD


async def fetch_naver_price(ticker: str) -> dict | None:
    """네이버 금융에서 현재가 스크래핑"""
    url = f"https://finance.naver.com/item/main.nhn?code={ticker}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            html = r.text

            # 현재가 추출
            import re
            price_match = re.search(r'<p class="no_today">.*?<span class="blind">([\d,]+)</span>', html, re.DOTALL)
            change_match = re.search(r'<span class="[^"]*(?:up|down)[^"]*">.*?<span class="blind">([\d.]+)%</span>', html, re.DOTALL)
            direction_match = re.search(r'<span class="(up|down)">', html)

            if price_match:
                price = float(price_match.group(1).replace(",", ""))
                change_rate = 0.0
                if change_match:
                    change_rate = float(change_match.group(1))
                    if direction_match and direction_match.group(1) == "down":
                        change_rate = -change_rate

                return {"price": price, "change_rate": change_rate, "source": "naver"}
    except Exception as e:
        print(f"[Price] 네이버 스크래핑 실패: {ticker} — {e}")
    return None


async def fetch_pykrx_price(ticker: str) -> dict | None:
    """pykrx로 일봉 데이터 조회 (장 마감 후)"""
    try:
        import pykrx.stock as stock
        today_str = date.today().strftime("%Y%m%d")
        df = stock.get_market_ohlcv_by_date(today_str, today_str, ticker)
        if not df.empty:
            row = df.iloc[-1]
            close = float(row.get("종가", 0))
            open_p = float(row.get("시가", close))
            change_rate = ((close - open_p) / open_p * 100) if open_p else 0.0

            # 시가총액
            market_df = stock.get_market_cap_by_date(today_str, today_str, ticker)
            market_cap = int(market_df.iloc[-1]["시가총액"]) if not market_df.empty else None

            return {
                "price": close,
                "change_rate": round(change_rate, 2),
                "source": "pykrx",
                "market_cap": market_cap,
            }
    except Exception as e:
        print(f"[Price] pykrx 조회 실패: {ticker} — {e}")
    return None


async def save_price_snapshot(session, position_id: str, price_data: dict):
    """주가 스냅샷 저장 및 급등락 알림 처리"""
    import uuid

    snap_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO price_snapshots
                (id, position_id, price, change_rate, volume, market_cap, source, snapshot_at)
            VALUES (:id, :pid, :price, :cr, :vol, :mc, :src, :sat)
        """),
        {
            "id": snap_id,
            "pid": position_id,
            "price": price_data.get("price", 0),
            "cr": price_data.get("change_rate", 0),
            "vol": price_data.get("volume"),
            "mc": price_data.get("market_cap"),
            "src": price_data.get("source", "unknown"),
            "sat": datetime.now(),
        },
    )
    await session.commit()


async def create_price_alert(session, position_id: str, company_name: str,
                              price: float, change_rate: float):
    """급등락 알림 생성"""
    import uuid

    direction = "급등" if change_rate > 0 else "급락"
    alert_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO alerts (id, position_id, alert_type, severity, title, body, created_at)
            VALUES (:id, :pid, 'PRICE_MOVEMENT', 'CRITICAL', :title, :body, :cat)
        """),
        {
            "id": alert_id,
            "pid": position_id,
            "title": f"{company_name} 주가 {direction} ({change_rate:+.1f}%)",
            "body": f"현재가: {price:,.0f}원",
            "cat": datetime.now(),
        },
    )
    await session.commit()
    print(f"[Price] 🚨 급등락 알림: {company_name} {change_rate:+.1f}%")


async def poll_prices_realtime():
    """장중 주가 폴링"""
    now = datetime.now()
    hour = now.hour
    weekday = now.weekday()

    # 평일 장중 (09:00~15:30)만 실행
    if weekday >= 5 or not (9 <= hour < 16):
        return

    print(f"[Price] 장중 주가 폴링 시작 — {now}")

    async with AsyncSessionLocal() as session:
        threshold = await get_price_threshold(session)

        result = await session.execute(
            text("SELECT id, underlying_ticker, underlying_company_name FROM positions WHERE is_active = 1")
        )
        positions = [{"id": r[0], "ticker": r[1], "company_name": r[2]} for r in result.fetchall()]

        processed = set()
        for pos in positions:
            ticker = pos["ticker"]
            if ticker in processed:
                continue
            processed.add(ticker)

            price_data = await fetch_naver_price(ticker)
            if not price_data:
                continue

            same_ticker = [p for p in positions if p["ticker"] == ticker]
            for p in same_ticker:
                await save_price_snapshot(session, p["id"], price_data)

                change_rate = price_data.get("change_rate", 0)
                if abs(change_rate) >= threshold:
                    await create_price_alert(
                        session, p["id"], p["company_name"],
                        price_data["price"], change_rate
                    )

            await asyncio.sleep(0.3)

    print(f"[Price] 장중 폴링 완료")


async def daily_price_close():
    """장 마감 후 종가 확정 (pykrx)"""
    print(f"[Price] 장 마감 종가 수집 시작 — {datetime.now()}")

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT id, underlying_ticker, underlying_company_name FROM positions WHERE is_active = 1")
        )
        positions = [{"id": r[0], "ticker": r[1], "company_name": r[2]} for r in result.fetchall()]

        processed = set()
        for pos in positions:
            ticker = pos["ticker"]
            if ticker in processed:
                continue
            processed.add(ticker)

            price_data = await fetch_pykrx_price(ticker)
            if not price_data:
                price_data = await fetch_naver_price(ticker)
            if not price_data:
                continue

            same_ticker = [p for p in positions if p["ticker"] == ticker]
            for p in same_ticker:
                await save_price_snapshot(session, p["id"], price_data)

    print(f"[Price] 장 마감 종가 수집 완료")
