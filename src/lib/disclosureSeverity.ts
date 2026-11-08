import { isAdjustmentDisclosure } from "@/lib/conversionAdjustExtract";

/**
 * 공시 제목 → 중요도 배지.
 *
 * worker/parsers/disclosure.py 의 classify_disclosure 와 같은 키워드다. 워커가 DB 에
 * 넣는 공시와 상세 화면이 DART 에서 바로 받아 보여주는 공시가 같은 기준으로 표시되게 한다.
 * (대시보드의 공시 "알림" 판정은 접수일까지 보는 별도 규칙이다 — api/dashboard/feed.)
 */
const CRITICAL_KEYWORDS = [
  "부도",
  "회생절차",
  "파산",
  "감사보고서",
  "자본잠식",
  "횡령",
  "배임",
  "거래정지",
  "관리종목",
  "상장폐지",
  "유상증자",
  "무상증자",
  "주식분할",
  "전환사채",
  "신주인수권",
  "교환사채",
  "전환청구",
];

const WARNING_KEYWORDS = [
  "최대주주변경",
  "대표이사변경",
  "영업양수도",
  "합병",
  "분할",
  "소송",
  "우발채무",
  "분기보고서",
  "반기보고서",
  "사업보고서",
  "주요사항보고서",
];

export type DisclosureSeverity = "CRITICAL" | "WARNING" | "INFO";

export function classifyDisclosureTitle(title: string): DisclosureSeverity {
  // 워커 목록의 "전환가액의 조정" 은 띄어쓰기가 있어 DART 제목("전환가액의조정")에
  // 안 걸린다 — 조정 공시는 자동 조정 로직과 같은 판정 함수로 본다.
  if (isAdjustmentDisclosure(title)) return "CRITICAL";
  if (CRITICAL_KEYWORDS.some((k) => title.includes(k))) return "CRITICAL";
  if (WARNING_KEYWORDS.some((k) => title.includes(k))) return "WARNING";
  return "INFO";
}
