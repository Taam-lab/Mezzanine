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

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("ko-KR");
}

export const MEZZANINE_TYPES = ["CB", "BW", "EB", "RCPS"] as const;
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
