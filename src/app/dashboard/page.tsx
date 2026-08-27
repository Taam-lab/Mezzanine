"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Briefcase,
  Bell,
  RefreshCw,
  Newspaper,
  FileText,
  ExternalLink,
  X,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { formatPercent, formatDateTime, formatKRWShort, SEVERITY_LABEL } from "@/lib/utils";

interface DashboardStats {
  totalPositions: number;
  topRisers: Mover[];
  topFallers: Mover[];
}

interface DbAlertItem {
  id: string;
  title: string;
  severity: string;
  createdAt: string;
  sourceUrl?: string;
  metadata?: string | null;
  position?: { assetName: string };
}

interface Mover {
  id: string;
  assetName: string;
  underlyingCompanyName: string;
  underlyingTicker: string;
  changeRate: number | null;
  currentPrice: number | null;
  currentConversionPrice: number | null;
}

interface FeedItem {
  title: string;
  url: string;
  date: string;
  isoDate: string;
  source?: string;
  ticker: string;
  companyName: string;
}

interface UiAlert {
  id?: string; // DB 알림만 있음 — 삭제 대상
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  url?: string;
  date: string; // 표시용
  isoDate: string; // 정렬용
  kind: "disclosure" | "price" | "db";
  ticker?: string;
}

interface PositionSlim {
  id: string;
  assetName: string;
  underlyingTicker: string;
  underlyingCompanyName: string;
  currentConversionPrice: number | null;
  investmentAmount: string | null;
  putOptionStartDate: string | null;
  putOptionEndDate: string | null;
  putOptionSchedule: string | null;
  isActive: boolean;
}

/**
 * 오늘 날짜가 어느 풋옵션 회차 안에 있으면 그 회차 (from, to) 반환.
 *
 * 우선순위:
 *   1. 회차별 스케줄 JSON 이 있으면 → 오늘 포함된 row 만 매칭 (없으면 null 반환)
 *      스케줄이 있다는 건 파싱이 성공했다는 뜻 → 매칭 실패 = 진짜 현재 행사 불가.
 *      putOptionStartDate/EndDate 는 스케줄의 첫/마지막 회차를 aggregate 한 값이라
 *      "전체 lifetime" 이지 "현재 회차" 가 아님. 폴백에 쓰면 잘못된 범위가 뜸.
 *   2. 스케줄이 없는 옛 종목(파싱 실패) 만 start/end 폴백 사용, 그것도 range <= 62일
 *      일 때만 (한 회차로 볼 만한 길이). 60+ 일이면 lifetime 이라 신뢰 못 함.
 */
function currentPutWindow(p: PositionSlim): { from: string; to: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (p.putOptionSchedule) {
    try {
      const rows = JSON.parse(p.putOptionSchedule) as Array<{ from: string; to: string }>;
      for (const r of rows) {
        const from = new Date(r.from);
        const to = new Date(r.to);
        if (today >= from && today <= to) return r;
      }
    } catch {
      // ignore
    }
    return null; // 스케줄이 있는데 매칭 실패 = 현재 행사 불가 (start/end 폴백 안 함)
  }
  if (p.putOptionStartDate && p.putOptionEndDate) {
    const from = new Date(p.putOptionStartDate);
    const to = new Date(p.putOptionEndDate);
    if (today >= from && today <= to) {
      const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 62) {
        return { from: p.putOptionStartDate, to: p.putOptionEndDate };
      }
    }
  }
  return null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [news, setNews] = useState<FeedItem[]>([]);
  const [disclosures, setDisclosures] = useState<FeedItem[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(false);
  const [alertList, setAlertList] = useState<UiAlert[]>([]);
  const [positions, setPositions] = useState<PositionSlim[]>([]);

  async function deleteAlert(alertId: string) {
    try {
      const res = await fetch(`/api/alerts?id=${alertId}`, { method: "DELETE" });
      if (!res.ok) return;
      setAlertList((prev) => prev.filter((a) => a.id !== alertId));
    } catch {
      // ignore
    }
  }

  async function clearAllAlerts() {
    if (!confirm("모든 알림을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/alerts?all=true", { method: "DELETE" });
      if (!res.ok) return;
      setAlertList([]);
    } catch {
      // ignore
    }
  }

  // 대시보드 로드 전략:
  //   0) sessionStorage 캐시가 있으면 즉시 렌더 (0ms 체감) → 뒤에서 refresh
  //   1) positions (수백 ms) → 요약 타일 즉시
  //   2) prices + DB alerts 병렬 → 시세/알림
  //   3) 뉴스/공시 feed (백그라운드) → 하단 카드 + 공시 알림 병합 + DB 저장
  async function loadDashboard(opts?: { forceRefresh?: boolean }) {
    const forceRefresh = opts?.forceRefresh ?? false;

    // Step 0: 캐시 hydrate (강제 새로고침이 아닐 때만)
    if (!forceRefresh && typeof window !== "undefined") {
      const cached = sessionStorage.getItem("dashboardCache");
      if (cached) {
        try {
          const c = JSON.parse(cached) as {
            stats?: DashboardStats;
            positions?: PositionSlim[];
            news?: FeedItem[];
            disclosures?: FeedItem[];
            alertList?: UiAlert[];
            ts?: number;
          };
          if (c.stats) setStats(c.stats);
          if (c.positions) setPositions(c.positions);
          if (c.news) setNews(c.news);
          if (c.disclosures) setDisclosures(c.disclosures);
          if (c.alertList) setAlertList(c.alertList);
          if (c.ts) setLastUpdated(new Date(c.ts));
          setLoading(false); // 캐시로 요약 표시
        } catch {
          // ignore
        }
      }
    }

    setLoading((prev) => prev && true);
    setFeedsLoading(true);
    try {
      // 통합 init: positions + alerts + Naver 시세를 서버에서 병렬로 처리.
      // 클라이언트 왕복 3번 → 1번, lambda 콜드스타트 3번 → 1번.
      // 힌트 티커(sessionStorage 캐시)를 넘기면 서버가 positions/alerts 조회와 시세 조회를 진짜 병렬로 실행.
      const hintedRaw =
        typeof window !== "undefined"
          ? sessionStorage.getItem("positionTickers")
          : null;
      let hintedTickerList: string[] = [];
      try {
        hintedTickerList = hintedRaw ? (JSON.parse(hintedRaw) as string[]) : [];
      } catch {
        hintedTickerList = [];
      }
      const tickerHint =
        hintedTickerList.length > 0 ? `&tickers=${hintedTickerList.join(",")}` : "";

      // 힌트 티커+회사명 캐시가 있으면 feed도 init과 동시에 시작 → 전체 wall clock 단축
      const hintedNameEntriesRaw =
        typeof window !== "undefined"
          ? sessionStorage.getItem("positionTickerNames")
          : null;
      const preFeedPromise =
        hintedNameEntriesRaw && !forceRefresh
          ? fetch(`/api/dashboard/feed?tickers=${hintedNameEntriesRaw}&t=${Date.now()}`, {
              cache: "no-store",
            })
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null);

      const initRes = await fetch(`/api/dashboard/init?t=${Date.now()}${tickerHint}`, {
        cache: "no-store",
      });
      const init = (await initRes.json()) as {
        positions: PositionSlim[];
        alerts: DbAlertItem[];
        quotes: Record<string, { price?: number; changeRate?: number }>;
        tickers: string[];
      };
      const positions = init.positions;
      const quotes = init.quotes ?? {};

      const tickerNameMap = new Map<string, string>();
      for (const p of positions) {
        if (!p.isActive || !/^\d{6}$/.test(p.underlyingTicker)) continue;
        if (!tickerNameMap.has(p.underlyingTicker)) {
          tickerNameMap.set(p.underlyingTicker, p.underlyingCompanyName);
        }
      }
      const tickers = Array.from(tickerNameMap.keys());
      const tickerNameEntries = Array.from(tickerNameMap.entries())
        .map(([t, n]) => `${t}:${encodeURIComponent(n)}`)
        .join(",");

      // 티커 & 티커:이름 캐시 저장 (다음 로드시 init/feed 힌트로 활용)
      if (tickers.length > 0 && typeof window !== "undefined") {
        try {
          sessionStorage.setItem("positionTickers", JSON.stringify(tickers));
          sessionStorage.setItem("positionTickerNames", tickerNameEntries);
        } catch {
          // ignore
        }
      }

      setPositions(positions);
      setStats({ totalPositions: positions.length, topRisers: [], topFallers: [] });
      setLastUpdated(new Date());
      setLoading(false);

      const dbAlertRes = init.alerts;

      // 활성 종목 + 시세 join
      const withQuotes: Mover[] = positions
        .filter((p) => p.isActive)
        .map((p) => {
          const q = quotes[p.underlyingTicker];
          return {
            id: p.id,
            assetName: p.assetName,
            underlyingCompanyName: p.underlyingCompanyName,
            underlyingTicker: p.underlyingTicker,
            changeRate: q?.changeRate ?? null,
            currentPrice: q?.price ?? null,
            currentConversionPrice: p.currentConversionPrice,
          };
        });

      // 상승 상위 5, 하락 상위 5
      const topRisers = withQuotes
        .filter((m) => (m.changeRate ?? 0) > 0)
        .sort((a, b) => (b.changeRate ?? 0) - (a.changeRate ?? 0))
        .slice(0, 5);
      const topFallers = withQuotes
        .filter((m) => (m.changeRate ?? 0) < 0)
        .sort((a, b) => (a.changeRate ?? 0) - (b.changeRate ?? 0))
        .slice(0, 5);

      const priceAlerts: UiAlert[] = [];
      const nowIso = new Date().toISOString();
      for (const p of positions) {
        if (!p.isActive) continue;
        const q = quotes[p.underlyingTicker];
        const rate = q?.changeRate;
        if (rate === undefined || rate === null || !Number.isFinite(rate)) continue;
        const abs = Math.abs(rate);
        if (abs >= 10) {
          priceAlerts.push({
            severity: "CRITICAL",
            title: `[${p.underlyingCompanyName}] 주가 ${rate >= 0 ? "+" : ""}${rate.toFixed(2)}% ${rate >= 0 ? "급등" : "급락"}`,
            date: formatDateTime(new Date()),
            isoDate: nowIso,
            kind: "price",
            ticker: p.underlyingTicker,
            url: `/positions/${p.id}`,
          });
        } else if (abs >= 5) {
          priceAlerts.push({
            severity: "WARNING",
            title: `[${p.underlyingCompanyName}] 주가 ${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
            date: formatDateTime(new Date()),
            isoDate: nowIso,
            kind: "price",
            ticker: p.underlyingTicker,
            url: `/positions/${p.id}`,
          });
        }
      }

      const dbAlerts: UiAlert[] = (dbAlertRes as DbAlertItem[]).map((a) => {
        // metadata.eventAt (공시 접수일 등) 이 있으면 표시·정렬에 우선 사용.
        // 없으면 createdAt (DB 저장 시각) 폴백.
        let eventAt: string | null = null;
        if (a.metadata) {
          try {
            const meta = JSON.parse(a.metadata) as { eventAt?: string };
            if (meta.eventAt) eventAt = meta.eventAt;
          } catch {
            // ignore
          }
        }
        const displayIso = eventAt ?? a.createdAt;
        return {
          id: a.id,
          severity: (["CRITICAL", "WARNING", "INFO"].includes(a.severity)
            ? a.severity
            : "INFO") as "CRITICAL" | "WARNING" | "INFO",
          title: a.title,
          url: a.sourceUrl,
          date: formatDateTime(displayIso),
          isoDate: displayIso,
          kind: "db",
        };
      });

      setStats({ totalPositions: positions.length, topRisers, topFallers });
      setAlertList(
        [...priceAlerts, ...dbAlerts].sort((a, b) =>
          a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0,
        ),
      );

      // 가격 알림 DB 저장 (POST /api/alerts, dedup 60분 윈도우)
      if (priceAlerts.length > 0) {
        const posByTicker = new Map(positions.map((p) => [p.underlyingTicker, p.id]));
        fetch("/api/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alerts: priceAlerts.map((a) => ({
              positionId: a.ticker ? posByTicker.get(a.ticker) ?? null : null,
              alertType: "PRICE_MOVE",
              severity: a.severity,
              title: a.title,
              dedupWithinMinutes: 60,
            })),
          }),
        }).catch(() => {});
      }

      // Step 3: 뉴스/공시 — 힌트로 이미 시작한 preFeedPromise 재사용, 없으면 지금 시작
      if (tickers.length === 0) {
        setFeedsLoading(false);
        return;
      }
      const preFeed = await preFeedPromise;
      const feedPromise: Promise<unknown> = preFeed
        ? Promise.resolve(preFeed)
        : fetch(`/api/dashboard/feed?tickers=${tickerNameEntries}&t=${Date.now()}`, {
            cache: "no-store",
          })
            .then((r) => r.json())
            .catch(() => null);

      feedPromise
        .then((feedRes) => {
          if (!feedRes) {
            setFeedsLoading(false);
            return;
          }
          const feedData = feedRes as {
            news: FeedItem[];
            disclosures: FeedItem[];
            alerts: Array<{
              severity: "CRITICAL" | "WARNING" | "INFO";
              title: string;
              url?: string;
              date: string;
              isoDate: string;
              ticker: string;
            }>;
          };
          const disclosureAlerts: UiAlert[] = (feedData.alerts ?? []).map((a) => ({
            severity: a.severity,
            title: a.title,
            url: a.url,
            date: a.date,
            isoDate: a.isoDate,
            kind: "disclosure",
            ticker: a.ticker,
          }));
          setNews(feedData.news ?? []);
          setDisclosures(feedData.disclosures ?? []);
          const mergedAlerts = [...priceAlerts, ...dbAlerts, ...disclosureAlerts].sort(
            (a, b) => (a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0),
          );
          setAlertList(mergedAlerts);

          // 세션 캐시 저장 (다음 진입시 즉시 렌더)
          try {
            sessionStorage.setItem(
              "dashboardCache",
              JSON.stringify({
                stats: { totalPositions: positions.length, topRisers, topFallers },
                positions,
                news: feedData.news ?? [],
                disclosures: feedData.disclosures ?? [],
                alertList: mergedAlerts,
                ts: Date.now(),
              }),
            );
          } catch {
            // storage full 등 무시
          }

          // 공시 알림 DB 저장 (sourceUrl 기반 dedup — 같은 rcpNo는 한 번만 저장됨)
          //   eventAt = 공시 접수일 (feed의 isoDate). Alert.metadata 에 저장되어 UI 가 표시 시각으로 사용.
          if (disclosureAlerts.length > 0) {
            const posByTicker = new Map(positions.map((p) => [p.underlyingTicker, p.id]));
            fetch("/api/alerts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                alerts: disclosureAlerts.map((a) => ({
                  positionId: a.ticker ? posByTicker.get(a.ticker) ?? null : null,
                  alertType: "DISCLOSURE",
                  severity: a.severity,
                  title: a.title,
                  sourceUrl: a.url,
                  eventAt: a.isoDate,
                })),
              }),
            }).catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => setFeedsLoading(false));

      // 전환가액 조정 공시 스캔 (백그라운드 fire-and-forget).
      // 회차 매칭되면 currentConversionPrice 자동 업데이트 + 이력 기록 + CRITICAL 알림.
      fetch(`/api/dashboard/process-adjustments?t=${Date.now()}`, {
        cache: "no-store",
      }).catch(() => {});
    } catch {
      setLoading(false);
      setFeedsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const severityBadge = (severity: string) => {
    const map: Record<string, "critical" | "warning" | "info"> = {
      CRITICAL: "critical",
      WARNING: "warning",
      INFO: "info",
    };
    return map[severity] || "neutral";
  };

  const critical = alertList.filter((a) => a.severity === "CRITICAL");
  const warning = alertList.filter((a) => a.severity === "WARNING");
  const info = alertList.filter((a) => a.severity === "INFO");
  const recent = alertList.slice(0, 10);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">대시보드</h1>
            {lastUpdated && (
              <p className="text-xs text-gray-500 mt-0.5">
                마지막 업데이트: {formatDateTime(lastUpdated)}
              </p>
            )}
          </div>
          <button
            onClick={() => loadDashboard({ forceRefresh: true })}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Briefcase className="h-5 w-5 text-[#0A2A5E]" />
              </div>
              <div>
                <p className="text-xs text-gray-500">보유 종목</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">
                  {stats?.totalPositions ?? "-"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-100">
            <CardContent className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">긴급 알림</p>
                <p className="text-2xl font-bold text-red-600 tabular-nums">
                  {loading ? "-" : critical.length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-yellow-100">
            <CardContent className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
                <Activity className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">중요 알림</p>
                <p className="text-2xl font-bold text-yellow-600 tabular-nums">
                  {loading ? "-" : warning.length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center">
                <Bell className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">일반 알림</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">
                  {loading ? "-" : info.length}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 풋옵션 행사 가능 종목 — 최근알림/변동TOP 위, 가로 전체 폭 */}
        {(() => {
          const exercisable = positions
            .filter((p) => p.isActive)
            .map((p) => ({ pos: p, win: currentPutWindow(p) }))
            .filter((r) => r.win !== null) as Array<{
            pos: PositionSlim;
            win: { from: string; to: string };
          }>;
          return (
            <Card className="border-red-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-red-600" />
                  풋옵션 행사 가능 종목
                  <span className="text-xs text-gray-400 font-normal ml-1">
                    (오늘 {new Date().toLocaleDateString("ko-KR")})
                  </span>
                </CardTitle>
                <span className="text-xs font-semibold text-red-600">
                  {exercisable.length}건
                </span>
              </CardHeader>
              <CardContent className="py-3">
                {exercisable.length === 0 ? (
                  <p className="text-xs text-gray-400">현재 행사 가능한 종목이 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {exercisable.map(({ pos, win }) => (
                      <Link
                        key={pos.id}
                        href={`/positions/${pos.id}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors border border-red-100"
                      >
                        <span className="text-sm font-semibold text-gray-900">
                          {pos.assetName}
                        </span>
                        <span className="text-xs text-gray-500 tabular-nums">
                          {pos.investmentAmount
                            ? formatKRWShort(Number(pos.investmentAmount))
                            : "-"}
                        </span>
                        <span className="text-xs text-red-700 tabular-nums font-medium">
                          {win.from.slice(0, 10)} ~ {win.to.slice(0, 10)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 최근 알림 (긴급 + 경고 + 정보 병합, 시간 desc) */}
          <Card>
            <CardHeader>
              <CardTitle>최근 알림</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 hidden sm:inline">
                  주가 ±5% · 전일/당일 공시
                </span>
                {alertList.some((a) => a.id) && (
                  <button
                    onClick={clearAllAlerts}
                    className="text-xs text-gray-500 hover:text-red-600"
                    title="모든 알림 삭제"
                  >
                    전체 삭제
                  </button>
                )}
              </div>
            </CardHeader>
            <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">불러오는 중...</div>
              ) : recent.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">알림이 없습니다</div>
              ) : (
                recent.map((alert, i) => {
                  const inner = (
                    <div className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <Badge
                        variant={severityBadge(alert.severity)}
                        className="mt-0.5 flex-shrink-0"
                      >
                        {SEVERITY_LABEL[alert.severity] ?? alert.severity}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 line-clamp-2">{alert.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{alert.date}</p>
                      </div>
                    </div>
                  );
                  const body = alert.url ? (
                    alert.url.startsWith("/") ? (
                      <Link href={alert.url} className="flex-1 min-w-0">
                        {inner}
                      </Link>
                    ) : (
                      <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0"
                      >
                        {inner}
                      </a>
                    )
                  ) : (
                    <div className="flex-1 min-w-0">{inner}</div>
                  );
                  return (
                    <div key={alert.id ?? i} className="flex items-stretch group">
                      {body}
                      {alert.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteAlert(alert.id!);
                          }}
                          className="px-3 flex items-center text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="알림 삭제"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* 주가 변동 TOP — 좌: 상승 상위 5, 우: 하락 상위 5 */}
          <Card>
            <CardHeader>
              <CardTitle>주가 변동 TOP 5</CardTitle>
              <Link href="/positions" className="text-xs text-[#0A2A5E] hover:underline">
                전체보기
              </Link>
            </CardHeader>
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-gray-400">불러오는 중...</div>
            ) : !stats || (stats.topRisers.length === 0 && stats.topFallers.length === 0) ? (
              <div className="px-5 py-8 text-center text-sm text-gray-400">
                등록된 종목이 없거나 시세를 조회할 수 없습니다.
              </div>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                {/* 상승 */}
                <div>
                  <div className="px-4 py-2 text-xs font-semibold text-rise bg-red-50/40 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    상승
                  </div>
                  <div className="divide-y divide-gray-50">
                    {stats.topRisers.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-gray-400">
                        상승 종목 없음
                      </p>
                    ) : (
                      stats.topRisers.map((mover) => (
                        <Link
                          key={mover.id}
                          href={`/positions/${mover.id}`}
                          className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {mover.underlyingCompanyName}
                            </p>
                            <p className="text-xs text-gray-400 truncate">{mover.assetName}</p>
                          </div>
                          <span className="text-sm font-semibold text-rise tabular-nums">
                            {formatPercent(mover.changeRate ?? 0)}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
                {/* 하락 */}
                <div>
                  <div className="px-4 py-2 text-xs font-semibold text-fall bg-blue-50/40 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" />
                    하락
                  </div>
                  <div className="divide-y divide-gray-50">
                    {stats.topFallers.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-gray-400">
                        하락 종목 없음
                      </p>
                    ) : (
                      stats.topFallers.map((mover) => (
                        <Link
                          key={mover.id}
                          href={`/positions/${mover.id}`}
                          className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {mover.underlyingCompanyName}
                            </p>
                            <p className="text-xs text-gray-400 truncate">{mover.assetName}</p>
                          </div>
                          <span className="text-sm font-semibold text-fall tabular-nums">
                            {formatPercent(mover.changeRate ?? 0)}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* 기초자산 뉴스 (flat, 시간 desc) + 최근 공시 (flat, 시간 desc) */}
        {stats && stats.totalPositions > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="h-4 w-4 text-[#0A2A5E]" />
                  기초자산 뉴스
                </CardTitle>
                {feedsLoading && <span className="text-xs text-gray-400">불러오는 중...</span>}
              </CardHeader>
              <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
                {news.length === 0 && !feedsLoading ? (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">
                    최근 뉴스가 없습니다.
                  </div>
                ) : (
                  news.map((n, i) => (
                    <a
                      key={i}
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-[#0A2A5E]">
                          {n.companyName}
                        </span>
                        {n.source && (
                          <span className="text-xs text-gray-400">· {n.source}</span>
                        )}
                        <span className="text-xs text-gray-400 tabular-nums ml-auto">
                          {n.date}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 line-clamp-2">
                        {n.title}
                        <ExternalLink className="inline h-3 w-3 text-gray-300 ml-1" />
                      </p>
                    </a>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#0A2A5E]" />
                  기초자산 최근 공시
                </CardTitle>
                {feedsLoading && <span className="text-xs text-gray-400">불러오는 중...</span>}
              </CardHeader>
              <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
                {disclosures.length === 0 && !feedsLoading ? (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">
                    최근 공시가 없습니다.
                  </div>
                ) : (
                  disclosures.map((d, i) => (
                    <a
                      key={i}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-[#0A2A5E]">
                          {d.companyName}
                        </span>
                        <span className="text-xs text-gray-400 tabular-nums ml-auto">
                          {d.date}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 line-clamp-2">
                        {d.title}
                        <ExternalLink className="inline h-3 w-3 text-gray-300 ml-1" />
                      </p>
                    </a>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}

        {/* 빈 상태 안내 */}
        {stats && stats.totalPositions === 0 && (
          <Card className="border-dashed border-2 border-gray-200">
            <CardContent className="text-center py-12">
              <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-sm font-medium text-gray-900 mb-1">등록된 종목이 없습니다</h3>
              <p className="text-sm text-gray-500 mb-4">
                메자닌 종목을 등록하면 모니터링이 시작됩니다.
              </p>
              <Link
                href="/positions/new"
                className="inline-flex items-center px-4 py-2 bg-[#0A2A5E] text-white text-sm rounded-lg hover:bg-[#0d3a7a]"
              >
                첫 번째 종목 등록하기
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
