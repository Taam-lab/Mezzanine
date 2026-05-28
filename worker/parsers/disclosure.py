"""DART 공시 파서 — 전환가 조정 공시 감지 및 파싱"""

import re
from typing import Optional


def classify_disclosure(report_name: str) -> tuple[str, str]:
    """
    공시 분류 및 중요도 반환
    Returns: (report_type, severity)
    """
    name = report_name.lower()

    # 긴급 (CRITICAL)
    critical_keywords = [
        "부도", "회생절차", "파산", "감사보고서", "자본잠식",
        "횡령", "배임", "거래정지", "관리종목", "상장폐지",
        "유상증자", "무상증자", "주식분할", "전환사채", "신주인수권",
        "교환사채", "전환청구", "전환가액의 조정",
    ]
    for kw in critical_keywords:
        if kw in report_name:
            return _get_report_type(report_name), "CRITICAL"

    # 중요 (WARNING)
    warning_keywords = [
        "최대주주변경", "대표이사변경", "영업양수도", "합병", "분할",
        "소송", "우발채무", "분기보고서", "반기보고서", "사업보고서",
        "주요사항보고서",
    ]
    for kw in warning_keywords:
        if kw in report_name:
            return _get_report_type(report_name), "WARNING"

    return _get_report_type(report_name), "INFO"


def _get_report_type(report_name: str) -> str:
    if "전환가액" in report_name:
        return "CONVERSION_PRICE_ADJUSTMENT"
    if "전환사채" in report_name or "CB" in report_name:
        return "CB_ISSUANCE"
    if "신주인수권" in report_name or "BW" in report_name:
        return "BW_ISSUANCE"
    if "교환사채" in report_name or "EB" in report_name:
        return "EB_ISSUANCE"
    if "전환청구" in report_name:
        return "CONVERSION_REQUEST"
    if "유상증자" in report_name:
        return "RIGHTS_OFFERING"
    if "합병" in report_name:
        return "MERGER"
    if "감사" in report_name:
        return "AUDIT_REPORT"
    return "GENERAL"


def parse_conversion_price_adjustment(text: str) -> Optional[dict]:
    """
    '전환가액의 조정' 공시에서 조정 후 전환가액과 회차 정보 추출
    Returns: {"series_number": int, "new_price": float, "adjustment_date": str} or None
    """
    result = {}

    # 회차 추출 (예: "제5회차")
    series_match = re.search(r"제\s*(\d+)\s*회차?", text)
    if series_match:
        result["series_number"] = int(series_match.group(1))

    # 조정 후 전환가액
    price_patterns = [
        r"조정\s*후\s*전환가액[：:\s]*([\d,]+)\s*원",
        r"전환가액\s*조정[^.]*?([\d,]+)\s*원",
        r"전환가액[：:]\s*([\d,]+)\s*원",
    ]
    for pattern in price_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            price_str = match.group(1).replace(",", "")
            try:
                result["new_price"] = float(price_str)
                break
            except ValueError:
                continue

    # 조정 기준일
    date_patterns = [
        r"조정\s*기준일[：:\s]*(\d{4}[년\-./]\d{1,2}[월\-./]\d{1,2})",
        r"적용\s*일자[：:\s]*(\d{4}[년\-./]\d{1,2}[월\-./]\d{1,2})",
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            raw = match.group(1)
            normalized = re.sub(r"[년월/.]", "-", raw).replace("일", "")
            parts = [p.strip() for p in normalized.split("-") if p.strip()]
            if len(parts) == 3:
                result["adjustment_date"] = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
            break

    if "new_price" in result:
        return result
    return None
