"""
주가 데이터 폴링 Job — KOSCOM CHECK API 사용
- Vercel serverless는 IP가 매번 바뀌어 CHECK 화이트리스트와 안 맞으므로
  고정 IP 환경(사내 서버)에 배포된 이 워커에서만 CHECK API를 직접 호출한다.
- 활성 포지션의 종목코드를 CHECK로 조회 → PriceSnapshot에 저장.
- 웹 앱은 이 스냅샷만 읽는다.
"""

import os
import asyncio
import uuid
import httpx
from datetime import datetime
from sqlalchemy import text

from db import AsyncSessionLocal

CHECK_URL = "https://checkapi.koscom.co.kr/stock/m001/basic_info_all"
CHECK_CUST_ID = os.getenv("CHECK_CUST_ID", "")
CHECK_AUTH_KEY = os.getenv("CHECK_AUTH_KEY", "")

# 필요한 필드만 요청 (응답 최소화)
DATA_FIELDS = ",".join([
    "F15001",  # 현재가
    "F15004",  # 등락률
    "F15015",  # 거래량
    "F15028",  # 시가총액
    "F03003",  # 전일종가
    "F16002",  # 한글종목명
])

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


def _to_num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", ""))
    except (ValueError, TypeError):
        return None


async def fetch_check_price(client: httpx.AsyncClient, ticker: str) -> dict | None:
    """CHECK API로 현재가 조회. form-urlencoded body."""
    if not CHECK_CUST_ID or not CHECK_AUTH_KEY:
        print("[Price] CHECK_CUST_ID / CHECK_AUTH_KEY 미설정")
        return None
    try:
        r = await client.post(
            CHECK_URL,
            data={
                "cust_id": CHECK_CUST_ID,
                "auth_key": CHECK_AUTH_KEY,
                "jcode": ticker,
                "data_list": DATA_FIELDS,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=8.0,
        )
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            msg = data.get("message")
            if isinstance(msg, dict):
                print(f"[Price] CHECK 실패: {ticker} — {msg.get('errmsg')} ({msg.get('desc')})")
            else:
                print(f"[Price] CHECK 실패: {ticker} — {msg}")
            return None
        results = data.get("results") or data.get("result") or data.get("data") or []
        if not results:
            return None
        row = results[0]
        price = _to_num(row.get("F15001"))
        if price is None:
            return None
        return {
            "price": price,
            "change_rate": _to_num(row.get("F15004")) or 0.0,
            "volume": _to_num(row.get("F15015")),
            "market_cap": _to_num(row.get("F15028")),
            "source": "check",
        }
    except Exception as e:
        print(f"[Price] CHECK 요청 실패: {ticker} — {e}")
        return None


async def save_price_snapshot(session, position_id: str, price_data: dict):
    volume = int(price_data["volume"]) if price_data.get("volume") is not None else None
    market_cap = int(price_data["market_cap"]) if price_data.get("market_cap") is not None else None
    await session.execute(
        text("""
            INSERT INTO price_snapshots
                (id, position_id, price, change_rate, volume, market_cap, source, snapshot_at)
            VALUES (:id, :pid, :price, :cr, :vol, :mc, :src, :sat)
        """),
        {
            "id": str(uuid.uuid4()),
            "pid": position_id,
            "price": price_data["price"],
            "cr": price_data.get("change_rate", 0),
            "vol": volume,
            "mc": market_cap,
            "src": price_data.get("source", "check"),
            "sat": datetime.now(),
        },
    )


async def create_price_alert(session, position_id: str, company_name: str,
                              price: float, change_rate: float):
    direction = "급등" if change_rate > 0 else "급락"
    await session.execute(
        text("""
            INSERT INTO alerts (id, position_id, alert_type, severity, title, body, created_at)
            VALUES (:id, :pid, 'PRICE_MOVEMENT', 'CRITICAL', :title, :body, :cat)
        """),
        {
            "id": str(uuid.uuid4()),
            "pid": position_id,
            "title": f"{company_name} 주가 {direction} ({change_rate:+.1f}%)",
            "body": f"현재가: {price:,.0f}원",
            "cat": datetime.now(),
        },
    )
    print(f"[Price] 🚨 급등락: {company_name} {change_rate:+.1f}%")


async def _poll_impl(only_market_hours: bool):
    now = datetime.now()
    if only_market_hours:
        if now.weekday() >= 5 or not (9 <= now.hour < 16):
            return
    print(f"[Price] CHECK 폴링 시작 — {now:%Y-%m-%d %H:%M:%S}")

    async with AsyncSessionLocal() as session:
        threshold = await get_price_threshold(session)

        result = await session.execute(
            text("SELECT id, underlying_ticker, underlying_company_name FROM positions WHERE is_active = TRUE")
        )
        positions = [{"id": r[0], "ticker": r[1], "company_name": r[2]} for r in result.fetchall()]

        # 종목코드 기준으로 그룹화 (같은 종목을 참조하는 여러 포지션에 동일 스냅샷)
        by_ticker: dict[str, list[dict]] = {}
        for p in positions:
            by_ticker.setdefault(p["ticker"], []).append(p)

        async with httpx.AsyncClient() as client:
            # 8개씩 병렬 (CHECK 서버 부담 완화)
            tickers = list(by_ticker.keys())
            saved = 0
            for i in range(0, len(tickers), 8):
                batch = tickers[i:i + 8]
                quotes = await asyncio.gather(
                    *(fetch_check_price(client, t) for t in batch),
                    return_exceptions=False,
                )
                for t, quote in zip(batch, quotes):
                    if not quote:
                        continue
                    for p in by_ticker[t]:
                        await save_price_snapshot(session, p["id"], quote)
                        saved += 1
                        cr = quote.get("change_rate", 0)
                        if abs(cr) >= threshold:
                            await create_price_alert(
                                session, p["id"], p["company_name"], quote["price"], cr
                            )
                await session.commit()

    print(f"[Price] CHECK 폴링 완료 — {saved}건 저장")


async def poll_prices_realtime():
    """장중(평일 09:00~16:00) 실시간 폴링"""
    await _poll_impl(only_market_hours=True)


async def daily_price_close():
    """장 마감 종가 확정 (16:30 크론)"""
    await _poll_impl(only_market_hours=False)
