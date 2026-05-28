"""
OpenDART 공시 폴링 Job
- 5분마다 보유 종목의 신규 공시 수집
- 전환가액 조정 공시 감지 시 자동 업데이트
- 웹 푸시 알림 트리거
"""

import os
import asyncio
import httpx
from datetime import datetime, date
from sqlalchemy import text

from db import AsyncSessionLocal
from parsers.disclosure import classify_disclosure, parse_conversion_price_adjustment

DART_API_KEY = None  # DB에서 동적으로 로드
NEXTJS_URL = os.getenv("NEXTJS_URL", "http://localhost:3000")


async def get_dart_api_key(session) -> str | None:
    result = await session.execute(
        text("SELECT credentials FROM integrations WHERE service_name = 'opendart' AND is_enabled = 1")
    )
    row = result.fetchone()
    if not row or not row[0]:
        return None
    # 암호화된 키 복호화 (Next.js와 동일 로직)
    from decrypt_util import decrypt_credentials
    try:
        creds = decrypt_credentials(row[0])
        return creds.get("api_key")
    except Exception:
        return None


async def get_active_positions(session) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT id, underlying_ticker, underlying_company_name,
                   series_number, current_conversion_price
            FROM positions
            WHERE is_active = 1
        """)
    )
    rows = result.fetchall()
    return [
        {
            "id": row[0],
            "ticker": row[1],
            "company_name": row[2],
            "series_number": row[3],
            "current_conversion_price": row[4],
        }
        for row in rows
    ]


async def get_corp_code(ticker: str, api_key: str) -> str | None:
    """종목코드로 DART 기업코드 조회"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # DART 기업 목록 API (ZIP 파일이므로 별도 처리 필요)
            # 여기서는 간단하게 검색 API 사용
            r = await client.get(
                "https://opendart.fss.or.kr/api/company.json",
                params={"crtfc_key": api_key, "stock_code": ticker},
            )
            data = r.json()
            if data.get("status") == "000":
                return data.get("corp_code")
    except Exception as e:
        print(f"[DART] corp_code 조회 실패: {ticker} — {e}")
    return None


async def fetch_new_disclosures(corp_code: str, api_key: str) -> list[dict]:
    """특정 기업의 최근 공시 목록 조회"""
    today = date.today().strftime("%Y%m%d")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                "https://opendart.fss.or.kr/api/list.json",
                params={
                    "crtfc_key": api_key,
                    "corp_code": corp_code,
                    "bgn_de": today,
                    "end_de": today,
                    "sort": "date",
                    "sort_mth": "desc",
                    "page_count": 20,
                },
            )
            data = r.json()
            if data.get("status") == "000" and data.get("list"):
                return data["list"]
    except Exception as e:
        print(f"[DART] 공시 목록 조회 실패: {corp_code} — {e}")
    return []


async def save_disclosure_and_alert(session, position_id: str, disclosure: dict,
                                     report_type: str, severity: str):
    """공시 저장 및 알림 생성"""
    rcept_no = disclosure.get("rcept_no", "")
    report_name = disclosure.get("report_nm", "")
    filed_at_str = disclosure.get("rcept_dt", datetime.now().strftime("%Y%m%d"))
    dart_url = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

    # 중복 체크
    existing = await session.execute(
        text("SELECT id FROM disclosures WHERE rcept_no = :rno"),
        {"rno": rcept_no},
    )
    if existing.fetchone():
        return  # 이미 처리됨

    filed_at = datetime.strptime(filed_at_str, "%Y%m%d")

    import uuid
    disc_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO disclosures (id, position_id, rcept_no, corp_code, report_name,
                                     report_type, severity, filed_at, dart_url, created_at)
            VALUES (:id, :pid, :rno, :cc, :rname, :rtype, :sev, :fat, :url, :cat)
        """),
        {
            "id": disc_id,
            "pid": position_id,
            "rno": rcept_no,
            "cc": disclosure.get("corp_code", ""),
            "rname": report_name,
            "rtype": report_type,
            "sev": severity,
            "fat": filed_at,
            "url": dart_url,
            "cat": datetime.now(),
        },
    )

    # 알림 생성
    alert_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO alerts (id, position_id, alert_type, severity, title, body,
                                source_url, created_at)
            VALUES (:id, :pid, :atype, :sev, :title, :body, :url, :cat)
        """),
        {
            "id": alert_id,
            "pid": position_id,
            "atype": "DISCLOSURE",
            "sev": severity,
            "title": report_name,
            "body": f"접수번호: {rcept_no}",
            "url": dart_url,
            "cat": datetime.now(),
        },
    )

    await session.commit()
    print(f"[DART] 공시 저장: {report_name} [{severity}]")

    return disc_id


async def handle_conversion_price_adjustment(session, position: dict, disc_id: str, content: str):
    """전환가액 조정 공시 처리 — 현재 전환가 자동 업데이트"""
    parsed = parse_conversion_price_adjustment(content)
    if not parsed or "new_price" not in parsed:
        print(f"[DART] 전환가 파싱 실패: position={position['id']}")
        return

    # 회차 매칭
    if parsed.get("series_number") and position["series_number"]:
        if parsed["series_number"] != position["series_number"]:
            print(f"[DART] 회차 불일치: 공시={parsed['series_number']}, 포지션={position['series_number']}")
            return

    old_price = position["current_conversion_price"]
    new_price = parsed["new_price"]

    if old_price == new_price:
        return  # 변화 없음

    import uuid

    # 이력 기록
    await session.execute(
        text("""
            INSERT INTO conversion_price_history
                (id, position_id, old_price, new_price, adjustment_reason,
                 source_disclosure_id, adjusted_at, is_automatic)
            VALUES (:id, :pid, :op, :np, :reason, :did, :at, 1)
        """),
        {
            "id": str(uuid.uuid4()),
            "pid": position["id"],
            "op": old_price or 0,
            "np": new_price,
            "reason": "전환가액 조정 공시 자동 반영",
            "did": disc_id,
            "at": datetime.now(),
        },
    )

    # 현재 전환가 업데이트
    await session.execute(
        text("UPDATE positions SET current_conversion_price = :np, updated_at = :now WHERE id = :id"),
        {"np": new_price, "now": datetime.now(), "id": position["id"]},
    )

    # 🔴 긴급 알림 생성
    alert_id = str(uuid.uuid4())
    old_fmt = f"{old_price:,.0f}" if old_price else "미등록"
    new_fmt = f"{new_price:,.0f}"
    await session.execute(
        text("""
            INSERT INTO alerts (id, position_id, alert_type, severity, title, body, created_at)
            VALUES (:id, :pid, 'CONVERSION_PRICE_ADJUSTMENT', 'CRITICAL', :title, :body, :cat)
        """),
        {
            "id": alert_id,
            "pid": position["id"],
            "title": f"{position['company_name']} 전환가 자동 조정",
            "body": f"{old_fmt}원 → {new_fmt}원",
            "cat": datetime.now(),
        },
    )

    await session.commit()
    print(f"[DART] ✅ 전환가 자동 업데이트: {position['company_name']} {old_fmt}→{new_fmt}원")


async def poll_disclosures():
    """메인 폴링 함수"""
    print(f"[DART] 공시 폴링 시작 — {datetime.now()}")

    async with AsyncSessionLocal() as session:
        api_key = await get_dart_api_key(session)
        if not api_key:
            print("[DART] API 키 없음 — 공시 폴링 스킵")
            return

        positions = await get_active_positions(session)
        if not positions:
            print("[DART] 활성 포지션 없음")
            return

        # 중복 corp_code 방지
        processed_tickers = set()

        for position in positions:
            ticker = position["ticker"]
            if ticker in processed_tickers:
                continue
            processed_tickers.add(ticker)

            corp_code = await get_corp_code(ticker, api_key)
            if not corp_code:
                continue

            disclosures = await fetch_new_disclosures(corp_code, api_key)

            # 동일 ticker의 모든 포지션 찾기
            same_ticker_positions = [p for p in positions if p["ticker"] == ticker]

            for disc in disclosures:
                report_name = disc.get("report_nm", "")
                report_type, severity = classify_disclosure(report_name)

                for pos in same_ticker_positions:
                    disc_id = await save_disclosure_and_alert(
                        session, pos["id"], disc, report_type, severity
                    )

                    # 전환가액 조정 공시이면 추가 처리
                    if report_type == "CONVERSION_PRICE_ADJUSTMENT" and disc_id:
                        try:
                            rcept_no = disc.get("rcept_no", "")
                            async with httpx.AsyncClient(timeout=15) as client:
                                r = await client.get(
                                    f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"
                                )
                                content = r.text
                            await handle_conversion_price_adjustment(session, pos, disc_id, content)
                        except Exception as e:
                            print(f"[DART] 전환가 처리 오류: {e}")

            await asyncio.sleep(0.5)  # DART API 요청 제한

    print(f"[DART] 공시 폴링 완료")
