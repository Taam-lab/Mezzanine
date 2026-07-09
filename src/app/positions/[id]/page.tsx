"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeft,
  Edit2,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Clock,
  BarChart2,
  Trash2,
} from "lucide-react";
import {
  formatKRW,
  formatKRWShort,
  formatPercent,
  formatDate,
  formatDateTime,
  MEZZANINE_TYPE_LABEL,
  INVESTMENT_TYPE_LABEL,
  SEVERITY_LABEL,
  RISK_CHECK_LABELS,
} from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";

interface PositionDetail {
  id: string;
  bondCode: string | null;
  assetName: string;
  underlyingTicker: string;
  underlyingCompanyName: string;
  underlyingMarket: string;
  mezzanineType: string;
  issueDate: string | null;
  investmentType: string;
  investmentAmount: string | null;
  maturityDate: string | null;
  couponRate: number | null;
  ytm: number | null;
  initialConversionPrice: number | null;
  minConversionPrice: number | null;
  currentConversionPrice: number | null;
  conversionStartDate: string | null;
  conversionEndDate: string | null;
  putOptionRate: number | null;
  putOptionStartDate: string | null;
  putOptionEndDate: string | null;
  callOptionRatio: number | null;
  callOptionRate: number | null;
  callOptionStartDate: string | null;
  callOptionEndDate: string | null;
  seriesNumber: number | null;
  sourceDisclosureUrl: string | null;
  note: string | null;
  priceSnapshots: Array<{ price: number; changeRate: number; snapshotAt: string }>;
  conversionPriceHistory: Array<{
    id: string;
    oldPrice: number;
    newPrice: number;
    adjustmentReason: string | null;
    adjustedAt: string;
    isAutomatic: boolean;
  }>;
  riskCheckResults: Array<{
    checkId: string;
    status: string;
    checkedAt: string;
  }>;
  disclosures: Array<{
    id: string;
    reportName: string;
    severity: string;
    filedAt: string;
    dartUrl: string | null;
  }>;
  newsItems: Array<{
    id: string;
    title: string;
    source: string | null;
    sourceUrl: string;
    publishedAt: string;
  }>;
}

interface LivePrice {
  price: number;
  changeRate: number;
  tradedAt?: string;
}

/**
 * 조기상환청구권 "다음 행사가능 기간":
 * - 오늘 < 시작일 → "YYYY-MM-DD 부터 행사 가능"
 * - 시작일 ≤ 오늘 ≤ 종료일 → "현재 ~ 종료일까지 행사 가능"
 * - 오늘 > 종료일 → "행사 종료"
 */
function nextExerciseWindow(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso || !endIso) return "-";
  const start = new Date(startIso);
  const end = new Date(endIso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return `${formatDate(startIso)} 부터 행사 가능`;
  if (today <= end) return `현재 ~ ${formatDate(endIso)} 까지 행사 가능`;
  return "행사 종료";
}

export default function PositionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  const [refreshingPrice, setRefreshingPrice] = useState(false);

  const ticker = position?.underlyingTicker;

  async function refreshPrice(t: string) {
    setRefreshingPrice(true);
    try {
      const res = await fetch(`/api/prices/${t}`);
      if (res.ok) {
        const data = await res.json();
        setLivePrice({
          price: data.price,
          changeRate: data.changeRate,
          tradedAt: data.tradedAt,
        });
      }
    } catch {
      // ignore — 기존 스냅샷으로 폴백
    } finally {
      setRefreshingPrice(false);
    }
  }

  useEffect(() => {
    // 종목 상세 로드 전에 캐시된 티커로 시세 호출을 병렬 선행
    const cacheKey = `positionTicker:${params.id}`;
    const cachedTicker =
      typeof window !== "undefined" ? sessionStorage.getItem(cacheKey) : null;
    if (cachedTicker && /^\d{6}$/.test(cachedTicker)) {
      refreshPrice(cachedTicker);
    }

    fetch(`/api/positions/${params.id}`)
      .then((r) => {
        if (!r.ok) router.push("/positions");
        return r.json();
      })
      .then((data) => {
        setPosition(data);
        setLoading(false);
        if (data?.underlyingTicker) {
          sessionStorage.setItem(cacheKey, data.underlyingTicker);
          // 캐시로 이미 조회했으면 재호출 생략 (60s interval이 곧 갱신함)
          if (data.underlyingTicker !== cachedTicker) refreshPrice(data.underlyingTicker);
        }
      });
  }, [params.id, router]);

  useEffect(() => {
    if (!ticker) return;
    const id = setInterval(() => refreshPrice(ticker), 60_000);
    return () => clearInterval(id);
  }, [ticker]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-4 border-[#0A2A5E] border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (!position) return null;

  const snapshotPrice = position.priceSnapshots?.[0];
  const currentPrice = livePrice?.price ?? snapshotPrice?.price;
  const currentChangeRate = livePrice?.changeRate ?? snapshotPrice?.changeRate ?? 0;
  const isRise = currentChangeRate > 0;
  const isFall = currentChangeRate < 0;
  const parity =
    currentPrice && position.currentConversionPrice
      ? (currentPrice / position.currentConversionPrice) * 100
      : null;

  const chartData = position.priceSnapshots
    .slice(0, 30)
    .reverse()
    .map((s) => ({
      date: format(new Date(s.snapshotAt), "MM/dd"),
      price: s.price,
    }));

  const riskMap: Record<string, string> = {};
  position.riskCheckResults.forEach((r) => {
    riskMap[r.checkId] = r.status;
  });

  const riskStatusIcon = (status: string) => {
    if (status === "CRITICAL") return "🔴";
    if (status === "WARNING") return "🟡";
    return "🟢";
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Link href="/positions">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
                목록
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{position.underlyingCompanyName}</h1>
                <Badge variant="neutral">{position.mezzanineType}</Badge>
                {position.underlyingMarket && (
                  <Badge variant="neutral" className="text-xs">{position.underlyingMarket}</Badge>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{position.assetName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/positions/${position.id}/edit`}>
              <Button variant="outline" size="sm">
                <Edit2 className="h-4 w-4" />
                수정
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!confirm(`"${position.assetName}" 종목을 삭제하시겠습니까?\n관련 스냅샷·공시·뉴스·알림·이력 데이터도 모두 함께 영구 삭제됩니다.`)) return;
                const res = await fetch(`/api/positions/${position.id}`, { method: "DELETE" });
                if (res.ok) {
                  router.push("/positions");
                } else {
                  const data = await res.json().catch(() => ({}));
                  alert(data.error || `삭제 실패 (HTTP ${res.status})`);
                }
              }}
              className="text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              삭제
            </Button>
          </div>
        </div>

        {/* 주가 요약 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">현재가</p>
                {ticker && (
                  <button
                    onClick={() => refreshPrice(ticker)}
                    disabled={refreshingPrice}
                    className="text-[10px] text-gray-400 hover:text-gray-700 disabled:opacity-50"
                    title="네이버 실시간 시세 새로고침"
                  >
                    {refreshingPrice ? "..." : "↻"}
                  </button>
                )}
              </div>
              <p className="text-xl font-bold tabular-nums text-gray-900">
                {currentPrice ? formatKRW(currentPrice) : "-"}
              </p>
              {livePrice?.tradedAt && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  네이버 {livePrice.tradedAt.slice(11, 16)}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-gray-500">등락률</p>
              <p
                className={`text-xl font-bold tabular-nums flex items-center gap-1 ${
                  isRise ? "text-rise" : isFall ? "text-fall" : "text-gray-600"
                }`}
              >
                {isRise ? <TrendingUp className="h-4 w-4" /> : isFall ? <TrendingDown className="h-4 w-4" /> : null}
                {currentPrice ? formatPercent(currentChangeRate) : "-"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-gray-500">전환가 패리티</p>
              <p
                className={`text-xl font-bold tabular-nums ${
                  parity !== null
                    ? parity >= 100
                      ? "text-green-600"
                      : parity >= 80
                      ? "text-yellow-600"
                      : "text-red-600"
                    : "text-gray-400"
                }`}
              >
                {parity !== null ? parity.toFixed(1) + "%" : "-"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-gray-500">현재 전환가</p>
              <p className="text-xl font-bold tabular-nums text-gray-900">
                {position.currentConversionPrice
                  ? formatKRW(position.currentConversionPrice)
                  : "-"}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 왼쪽 2칸 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 주가 차트 */}
            {chartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>주가 차트</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => v.toLocaleString()}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        formatter={(v: unknown) => [(v as number).toLocaleString() + "원", "주가"]}
                      />
                      {position.currentConversionPrice && (
                        <ReferenceLine
                          y={position.currentConversionPrice}
                          stroke="#FF6B35"
                          strokeDasharray="4 4"
                          label={{ value: "전환가", position: "right", fontSize: 10 }}
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#0A2A5E"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* 투자 정보 */}
            <Card>
              <CardHeader>
                <CardTitle>메자닌 투자 정보</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {[
                  {
                    heading: "채권 기본 정보",
                    rows: [
                      ["채권종목번호", position.bondCode],
                      ["기초자산", `${position.underlyingCompanyName} (${position.underlyingTicker})`],
                      ["형태", MEZZANINE_TYPE_LABEL[position.mezzanineType] || position.mezzanineType],
                      ["회차", position.seriesNumber ? `제${position.seriesNumber}회` : "-"],
                      ["투자구분", INVESTMENT_TYPE_LABEL[position.investmentType] || position.investmentType],
                      ["투자금액", position.investmentAmount ? formatKRW(Number(position.investmentAmount)) : "-"],
                      ["발행일", formatDate(position.issueDate)],
                      ["만기일", formatDate(position.maturityDate)],
                      ["표면금리", position.couponRate !== null ? formatPercent(position.couponRate) : "-"],
                      ["만기이자율(YTM)", position.ytm !== null ? formatPercent(position.ytm) : "-"],
                    ] as Array<[string, string | null]>,
                  },
                  {
                    heading: "전환관련 사항",
                    rows: [
                      ["최초 전환가", position.initialConversionPrice ? formatKRW(position.initialConversionPrice) : "-"],
                      ["최저 전환가", position.minConversionPrice ? formatKRW(position.minConversionPrice) : "-"],
                      ["현재 전환가", position.currentConversionPrice ? formatKRW(position.currentConversionPrice) : "-"],
                      ["전환 가능 기간", position.conversionStartDate ? `${formatDate(position.conversionStartDate)} ~ ${formatDate(position.conversionEndDate)}` : "-"],
                    ] as Array<[string, string | null]>,
                  },
                  {
                    heading: "Put Option",
                    rows: [
                      ["풋옵션 수익률", position.putOptionRate !== null ? formatPercent(position.putOptionRate) : "-"],
                      ["풋옵션 행사 가능기간", position.putOptionStartDate ? `${formatDate(position.putOptionStartDate)} ~ ${formatDate(position.putOptionEndDate)}` : "-"],
                      ["다음 행사가능 기간", nextExerciseWindow(position.putOptionStartDate, position.putOptionEndDate)],
                    ] as Array<[string, string | null]>,
                  },
                  {
                    heading: "Call Option",
                    rows: [
                      ["콜옵션 금리", position.callOptionRate !== null ? formatPercent(position.callOptionRate) : "-"],
                      ["콜옵션 비율", position.callOptionRatio !== null ? formatPercent(position.callOptionRatio) : "-"],
                      ["콜옵션 행사 가능기간", position.callOptionStartDate ? `${formatDate(position.callOptionStartDate)} ~ ${formatDate(position.callOptionEndDate)}` : "-"],
                    ] as Array<[string, string | null]>,
                  },
                ].map((section) => (
                  <section key={section.heading}>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {section.heading}
                    </h4>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      {section.rows.map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-gray-500 text-xs">{label}</dt>
                          <dd className="text-gray-900 font-medium mt-0.5">{value || "-"}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
                {position.sourceDisclosureUrl && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <a
                      href={position.sourceDisclosureUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-[#0A2A5E] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      DART 공시 원문 보기
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 전환가 조정 이력 */}
            {position.conversionPriceHistory.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>전환가 조정 이력</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {position.conversionPriceHistory.map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center gap-3 text-sm py-2 border-b border-gray-50 last:border-0"
                      >
                        <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1">
                          <span className="tabular-nums font-medium">{formatKRW(h.oldPrice)}</span>
                          <span className="text-gray-400 mx-2">→</span>
                          <span className="tabular-nums font-medium text-[#0A2A5E]">{formatKRW(h.newPrice)}</span>
                          {h.adjustmentReason && (
                            <span className="text-gray-500 text-xs ml-2">({h.adjustmentReason})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {h.isAutomatic && (
                            <Badge variant="info" className="text-xs">자동</Badge>
                          )}
                          <span className="text-xs text-gray-400">{formatDate(h.adjustedAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 공시 타임라인 */}
            <Card>
              <CardHeader>
                <CardTitle>공시 타임라인</CardTitle>
              </CardHeader>
              <CardContent>
                {position.disclosures.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">공시 없음</p>
                ) : (
                  <div className="space-y-2">
                    {position.disclosures.map((d) => (
                      <div key={d.id} className="flex items-start gap-3 text-sm">
                        <Badge
                          variant={
                            d.severity === "CRITICAL"
                              ? "critical"
                              : d.severity === "WARNING"
                              ? "warning"
                              : "info"
                          }
                          className="mt-0.5 flex-shrink-0"
                        >
                          {SEVERITY_LABEL[d.severity]}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-900 truncate">{d.reportName}</p>
                          <p className="text-xs text-gray-400">{formatDateTime(d.filedAt)}</p>
                        </div>
                        {d.dartUrl && (
                          <a
                            href={d.dartUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 뉴스 피드 */}
            <Card>
              <CardHeader>
                <CardTitle>뉴스 피드</CardTitle>
              </CardHeader>
              <CardContent>
                {position.newsItems.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">관련 뉴스 없음</p>
                ) : (
                  <div className="space-y-3">
                    {position.newsItems.map((n) => (
                      <a
                        key={n.id}
                        href={n.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block hover:bg-gray-50 -mx-2 px-2 py-1 rounded-lg"
                      >
                        <p className="text-sm text-gray-900 hover:text-[#0A2A5E]">{n.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {n.source} · {formatDateTime(n.publishedAt)}
                        </p>
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 오른쪽 1칸 */}
          <div className="space-y-6">
            {/* 리스크 체크리스트 */}
            <Card>
              <CardHeader>
                <CardTitle>리스크 체크리스트</CardTitle>
              </CardHeader>
              <CardContent>
                {["재무", "시장", "거버넌스"].map((category) => (
                  <div key={category} className="mb-4 last:mb-0">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {category}
                    </p>
                    {Object.entries(RISK_CHECK_LABELS)
                      .filter(([, v]) => v.category === category)
                      .map(([id, { name }]) => {
                        const status = riskMap[id] || "NORMAL";
                        return (
                          <div key={id} className="flex items-center gap-2 py-1.5 text-sm">
                            <span className="text-base leading-none">{riskStatusIcon(status)}</span>
                            <span
                              className={
                                status === "CRITICAL"
                                  ? "text-red-700 font-medium"
                                  : status === "WARNING"
                                  ? "text-yellow-700"
                                  : "text-gray-700"
                              }
                            >
                              {name}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                ))}
                <p className="text-xs text-gray-400 mt-3">
                  마지막 업데이트:{" "}
                  {position.riskCheckResults[0]
                    ? formatDateTime(position.riskCheckResults[0].checkedAt)
                    : "아직 미체크"}
                </p>
              </CardContent>
            </Card>

            {/* 기타 정보 */}
            {position.note && (
              <Card>
                <CardHeader>
                  <CardTitle>비고</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{position.note}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
