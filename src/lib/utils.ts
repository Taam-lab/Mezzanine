import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatKRW(amount: number | bigint | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  return new Intl.NumberFormat("ko-KR").format(num) + "원";
}

export function formatKRWShort(amount: number | bigint | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  if (Math.abs(num) >= 1_000_000_000_000) return (num / 1_000_000_000_000).toFixed(1) + "조원";
  if (Math.abs(num) >= 100_000_000) return (num / 100_000_000).toFixed(0) + "억원";
  if (Math.abs(num) >= 10_000) return (num / 10_000).toFixed(0) + "만원";
  return formatKRW(num);
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(decimals) + "%";
}

/**
 * 날짜·시간 표시는 실행 환경의 타임존이 아니라 항상 한국 시간(KST) 기준.
 *
 * 이 함수들은 서버 렌더(Vercel = UTC)와 브라우저(KST) 양쪽에서 돈다. 로컬 타임존을
 * 따르면 같은 값이 서버에선 "오전 1:00", 브라우저에선 "오전 10:00" 으로 찍혀
 * 하이드레이션 불일치가 난다 — React 18 은 그 경우 서버 HTML 을 버리고 그 구간을
 * 클라이언트에서 처음부터 다시 렌더한다 (콘솔 에러 + 렌더 두 번). 사용자는 KST
 * 브라우저라 화면에 보이는 값은 예전과 같다.
 */
const KST = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 3600_000;

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: KST,
  });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("ko-KR", { timeZone: KST });
}

/** "2026. 11. 6." — 오늘(KST) 날짜 표기 */
export function formatTodayKST(): string {
  return new Date().toLocaleDateString("ko-KR", { timeZone: KST });
}

/**
 * 차트 x축용 "MM/DD". date-fns 의 format(d, "MM/dd") 를 대체하려고 만든 것으로,
 * 저장소 전체에서 그 호출 한 곳 때문에 의존성을 들고 있을 이유가 없었다.
 *
 * 반드시 KST 기준이어야 한다 — getUTC* 나 toISOString().slice() 를 그대로 쓰면
 * 09시 이전 KST 스냅샷의 x축이 하루씩 밀린다. (+9h 한 뒤 getUTC* 로 읽는 건 KST 벽시계)
 * toLocaleDateString("ko-KR") 도 안 된다 ("09. 22." 형태라 표기가 달라짐).
 */
export function formatMonthDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(kst.getUTCMonth() + 1)}/${pad(kst.getUTCDate())}`;
}

/**
 * 오늘 KST 자정 (= KST 브라우저에서 `new Date().setHours(0,0,0,0)` 한 값).
 * 서버(UTC)에서도 같은 값이 나와야 풋옵션 "행사 가능/예정/종료" 판정이 서버 렌더와
 * 하이드레이션에서 갈리지 않는다.
 */
export function startOfTodayKST(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS,
  );
}

export const MEZZANINE_TYPES = ["CB", "BW", "EB", "RCPS", "COMMON"] as const;
export const MARKETS = ["KOSPI", "KOSDAQ"] as const;
export const INVESTMENT_TYPES = ["DIRECT", "INDIRECT"] as const;
export const SEVERITY_LEVELS = ["CRITICAL", "WARNING", "INFO"] as const;
export const ALERT_TYPES = [
  "RISK",
  "NEWS",
  "PRICE_MOVEMENT",
  "DISCLOSURE",
  "CONVERSION_PRICE_ADJUSTMENT",
] as const;

export const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: "긴급",
  WARNING: "중요",
  INFO: "일반",
};

export const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "text-red-600 bg-red-50",
  WARNING: "text-yellow-600 bg-yellow-50",
  INFO: "text-green-600 bg-green-50",
};

export const MEZZANINE_TYPE_LABEL: Record<string, string> = {
  CB: "전환사채 (CB)",
  BW: "신주인수권부사채 (BW)",
  EB: "교환사채 (EB)",
  RCPS: "상환전환우선주 (RCPS)",
  COMMON: "보통주",
};

export const INVESTMENT_TYPE_LABEL: Record<string, string> = {
  DIRECT: "직접투자",
  INDIRECT: "간접투자",
};

export const RISK_CHECK_LABELS: Record<string, { name: string; category: string }> = {
  R1: { name: "자본잠식", category: "재무" },
  R2: { name: "매출액 미달", category: "재무" },
  R3: { name: "법인세차감전계속사업손실", category: "재무" },
  R4: { name: "장기영업손실", category: "재무" },
  R5: { name: "감사의견 비적정", category: "재무" },
  M1: { name: "시가총액 미달", category: "시장" },
  M2: { name: "주가 미달", category: "시장" },
  M3: { name: "거래량 부진", category: "시장" },
  G1: { name: "불성실공시법인 지정", category: "거버넌스" },
  G2: { name: "횡령·배임 발생", category: "거버넌스" },
  G3: { name: "회생절차/파산신청", category: "거버넌스" },
};
