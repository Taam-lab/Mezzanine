"""
주가 데이터 폴링 Job
- pykrx: 일봉 데이터 (장 마감 후)
- 네이버 금융 스크래핑: 장중 현재가
- 한국투자증권 API: 키 등록 시 자동 전환 (Phase 2)
"""

import os
import asyncio
import httpx
from datetime import datetime, date, timedelta
from sqlalchemy import text

from db import AsyncSessionLocal, utcnow, kst_day_start_utc

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


def _daily_change_rate(df) -> float:
    """전일 종가 대비 등락률(%).

    예전엔 (종가 - 시가) / 시가 — 장중 변동폭이었다. 웹앱과 네이버의 "등락률"은
    전일 종가 대비라서, 상세 화면이 이 스냅샷으로 등락률을 보여줄 때 값이 달랐다.
    pykrx 가 등락률 컬럼을 주면 그걸 쓰고, 없으면 직전 거래일 종가로 계산한다.
    """
    last = df.iloc[-1]
    if "등락률" in df.columns:
        return round(float(last["등락률"]), 2)
    if len(df) >= 2:
        prev = float(df.iloc[-2]["종가"])
        if prev:
            return round((float(last["종가"]) - prev) / prev * 100, 2)
    return 0.0


async def fetch_pykrx_price(ticker: str) -> dict | None:
    """pykrx로 일봉 데이터 조회 (장 마감 후)"""
    try:
        import pykrx.stock as stock
        today = date.today()
        today_str = today.strftime("%Y%m%d")
        # 직전 거래일 종가가 필요할 수 있어 2주 범위로 받는다 (연휴 대비).
        start_str = (today - timedelta(days=14)).strftime("%Y%m%d")
        df = stock.get_market_ohlcv_by_date(start_str, today_str, ticker)
        # 오늘 행이 없으면 휴장일 — 확정할 종가가 없다.
        if not df.empty and df.index[-1].strftime("%Y%m%d") == today_str:
            row = df.iloc[-1]
            close = float(row.get("종가", 0))
            change_rate = _daily_change_rate(df)

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
            "sat": utcnow(),
        },
    )
    await session.commit()


async def create_price_alert(session, position_id: str, company_name: str,
                              price: float, change_rate: float):
    """급등락 알림 생성 — 포지션·KST 하루당 1건.

    예전엔 5분 폴링마다 중복 확인 없이 INSERT 해서, 임계값을 넘은 날엔 종목 하나가
    하루 수십 건(장중 78회)의 긴급 알림을 쌓았다. 타입도 'PRICE_MOVEMENT' 라 대시보드가
    만드는 'PRICE_MOVE' 와 같은 사건이 두 번 보였다.

    대시보드(POST /api/alerts)와 같은 타입·문구·중복 기준을 쓴다:
      - 같은 포지션·타입·심각도 알림이 오늘(KST) 이미 있으면 스킵
      - 같은 문구(=같은 등락률)가 48시간 안에 있으면 스킵
    """
    import uuid

    direction = "급등" if change_rate > 0 else "급락"
    sign = "+" if change_rate >= 0 else ""
    title = f"[{company_name}] 주가 {sign}{change_rate:.2f}% {direction}"

    dup = await session.execute(
        text("""
            SELECT 1 FROM alerts
             WHERE position_id = :pid AND alert_type = 'PRICE_MOVE'
               AND ((severity = 'CRITICAL' AND created_at >= :day_start)
                    OR (title = :title AND created_at >= :since48h))
             LIMIT 1
        """),
        {
            "pid": position_id,
            "day_start": kst_day_start_utc(),
            "title": title,
            "since48h": utcnow() - timedelta(hours=48),
        },
    )
    if dup.fetchone():
        return

    await session.execute(
        text("""
            INSERT INTO alerts (id, position_id, alert_type, severity, title, body, created_at)
            VALUES (:id, :pid, 'PRICE_MOVE', 'CRITICAL', :title, :body, :cat)
        """),
        {
            "id": str(uuid.uuid4()),
            "pid": position_id,
            "title": title,
            "body": f"현재가: {price:,.0f}원",
            "cat": utcnow(),
        },
    )
    await session.commit()
    print(f"[Price] 🚨 급등락 알림: {title}")


async def poll_prices_realtime():
    """장중 주가 폴링"""
    now = datetime.now()  # 컨테이너 TZ=Asia/Seoul → KST 벽시계
    minutes = now.hour * 60 + now.minute

    # 평일 정규장 (09:00~15:30)만 실행. 예전 조건(9 <= hour < 16)은 장 마감 후
    # 15:30~16:00 에도 돌아서 마감 종가를 "장중" 스냅샷으로 여러 번 쌓았다.
    if now.weekday() >= 5 or not (9 * 60 <= minutes <= 15 * 60 + 30):
        return

    print(f"[Price] 장중 주가 폴링 시작 — {now}")

    async with AsyncSessionLocal() as session:
        threshold = await get_price_threshold(session)

        result = await session.execute(
            text("SELECT id, underlying_ticker, underlying_company_name FROM positions WHERE is_active = true")
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
            try:
                for p in same_ticker:
                    await save_price_snapshot(session, p["id"], price_data)

                    change_rate = price_data.get("change_rate", 0)
                    if abs(change_rate) >= threshold:
                        await create_price_alert(
                            session, p["id"], p["company_name"],
                            price_data["price"], change_rate
                        )
            except Exception as e:
                # 한 종목의 DB 오류가 세션을 "aborted transaction" 상태로 남겨
                # 나머지 종목까지 전부 실패하지 않도록 롤백하고 넘어간다.
                await session.rollback()
                print(f"[Price] 저장 실패: {ticker} — {e}")

            await asyncio.sleep(0.3)

    print(f"[Price] 장중 폴링 완료")


async def daily_price_close():
    """장 마감 후 종가 확정 (pykrx)"""
    print(f"[Price] 장 마감 종가 수집 시작 — {datetime.now()}")

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT id, underlying_ticker, underlying_company_name FROM positions WHERE is_active = true")
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
