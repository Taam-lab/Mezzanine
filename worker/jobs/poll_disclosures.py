"""
OpenDART 공시 폴링 Job
- 5분마다 보유 종목의 오늘자 신규 공시를 disclosures / alerts 에 적재

전환가액 조정 공시는 여기서 다루지 않는다 — 웹앱의 /api/dashboard/process-adjustments
가 DART 뷰어 본문을 긁어 회차를 매칭하고 전환가·이력·알림을 갱신한다. 예전엔 이 잡이
조정 공시를 disclosures 에 먼저 넣고(본문 대신 프레임셋 HTML 을 파싱해 실패), 그
rcept_no 가 이미 있으니 웹앱 쪽은 "처리됨"으로 건너뛰어 전환가가 끝내 반영되지 않았다.
"""

import os
import re
import json
import asyncio
import httpx
from datetime import datetime, date
from sqlalchemy import text

from db import AsyncSessionLocal, utcnow
from parsers.disclosure import classify_disclosure


def is_adjustment_disclosure(title: str) -> bool:
    """웹앱 src/lib/conversionAdjustExtract.ts 의 isAdjustmentDisclosure 와 같은 기준."""
    return bool(
        re.search(r"(?:전환|교환|청구)\s*가액.{0,10}?조정", title)
        or re.search(r"전환가액의?\s*조정", title)
        or re.search(r"리픽싱|refixing", title, re.IGNORECASE)
    )

DART_API_KEY = None  # DB에서 동적으로 로드
NEXTJS_URL = os.getenv("NEXTJS_URL", "http://localhost:3000")


async def get_dart_api_key(session) -> str | None:
    """관리자 화면(API 키 관리 → OpenDART)에 등록된 키, 없으면 환경변수 DART_API_KEY.

    예전엔 `is_enabled = 1` 이라 Postgres 에서 "operator does not exist:
    boolean = integer" 로 첫 쿼리부터 죽었다 (is_active 만 고쳐지고 이건 남아 있었다).
    또 render.yaml 은 DART_API_KEY 를 넘기는데 코드는 DB 만 봐서, 관리자 화면에
    키를 따로 넣지 않으면 "API 키 없음"으로 스킵됐다.
    """
    result = await session.execute(
        text("SELECT credentials FROM integrations WHERE service_name = 'opendart' AND is_enabled = true")
    )
    row = result.fetchone()
    if row and row[0]:
        # 암호화된 키 복호화 (Next.js와 동일 로직)
        from decrypt_util import decrypt_credentials
        try:
            key = decrypt_credentials(row[0]).get("api_key")
            if key:
                return key
        except Exception:
            pass
    return os.getenv("DART_API_KEY") or None


async def get_active_positions(session) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT id, underlying_ticker, underlying_company_name, corp_code
            FROM positions
            WHERE is_active = true
        """)
    )
    rows = result.fetchall()
    return [
        {
            "id": row[0],
            "ticker": row[1],
            "company_name": row[2],
            "corp_code": row[3],
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


async def save_disclosure_and_alert(session, position: dict, disclosure: dict,
                                     report_type: str, severity: str):
    """공시 저장 및 알림 생성.

    rcept_no(공시)·(alert_type, source_url)(알림)이 UNIQUE 라, 대시보드가 같은 공시로
    알림을 먼저 만들었거나 같은 티커의 다른 포지션에서 이미 넣었으면 INSERT 가
    충돌한다. 예전엔 그 IntegrityError 가 폴링 루프 전체를 죽였다 — ON CONFLICT 로 넘긴다.
    """
    position_id = position["id"]
    rcept_no = disclosure.get("rcept_no", "")
    report_name = disclosure.get("report_nm", "")
    filed_at_str = disclosure.get("rcept_dt", datetime.now().strftime("%Y%m%d"))
    dart_url = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

    # 접수일 — 웹앱과 같은 관례로 그 날짜의 00:00 (tz 없는 값)
    filed_at = datetime.strptime(filed_at_str, "%Y%m%d")

    import uuid
    disc_id = str(uuid.uuid4())
    inserted = await session.execute(
        text("""
            INSERT INTO disclosures (id, position_id, rcept_no, corp_code, report_name,
                                     report_type, severity, filed_at, dart_url, created_at)
            VALUES (:id, :pid, :rno, :cc, :rname, :rtype, :sev, :fat, :url, :cat)
            ON CONFLICT (rcept_no) DO NOTHING
            RETURNING id
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
            "cat": utcnow(),
        },
    )
    if inserted.fetchone() is None:
        await session.commit()
        return None  # 이미 처리됨

    # 알림 생성 — 대시보드가 만드는 공시 알림과 같은 모양으로:
    #   - 제목 "[회사명] 공시명"
    #   - metadata.eventAt = 접수일. 웹앱의 정리 작업(api/alerts)은 metadata 가 없는
    #     DISCLOSURE 알림을 "옛 형식"으로 보고 지우므로, 없으면 10분 안에 사라졌다.
    event_at = f"{filed_at_str[0:4]}-{filed_at_str[4:6]}-{filed_at_str[6:8]}"
    await session.execute(
        text("""
            INSERT INTO alerts (id, position_id, alert_type, severity, title, body,
                                source_url, metadata, created_at)
            VALUES (:id, :pid, :atype, :sev, :title, :body, :url, :meta, :cat)
            ON CONFLICT DO NOTHING
        """),
        {
            "id": str(uuid.uuid4()),
            "pid": position_id,
            "atype": "DISCLOSURE",
            "sev": severity,
            "title": f"[{position['company_name']}] {report_name}",
            "body": f"접수번호: {rcept_no}",
            "url": dart_url,
            "meta": json.dumps({"eventAt": event_at}),
            "cat": utcnow(),
        },
    )

    await session.commit()
    print(f"[DART] 공시 저장: {report_name} [{severity}]")

    return disc_id


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

            # 동일 ticker의 모든 포지션
            same_ticker_positions = [p for p in positions if p["ticker"] == ticker]

            # 웹앱이 등록·스캔 때 채워 둔 corp_code 를 먼저 쓴다. 예전엔 폴링마다
            # 티커별 company.json 을 불러, 5분 × 종목 수만큼 DART 일일 한도
            # (2만 건, 웹앱과 같은 키를 공유)를 소모했다.
            corp_code = next((p["corp_code"] for p in same_ticker_positions if p["corp_code"]), None)
            if not corp_code:
                corp_code = await get_corp_code(ticker, api_key)
            if not corp_code:
                continue

            disclosures = await fetch_new_disclosures(corp_code, api_key)

            try:
                for disc in disclosures:
                    report_name = disc.get("report_nm", "")
                    if is_adjustment_disclosure(report_name):
                        continue  # 웹앱 process-adjustments 담당 (모듈 docstring 참고)
                    report_type, severity = classify_disclosure(report_name)
                    # 같은 공시는 rcept_no UNIQUE 라 티커의 첫 포지션에만 붙는다.
                    await save_disclosure_and_alert(
                        session, same_ticker_positions[0], disc, report_type, severity
                    )
            except Exception as e:
                # 세션이 aborted transaction 상태로 남아 다음 티커까지 실패하지 않게.
                await session.rollback()
                print(f"[DART] 공시 저장 실패: {ticker} — {e}")

            await asyncio.sleep(0.5)  # DART API 요청 제한

    print(f"[DART] 공시 폴링 완료")
