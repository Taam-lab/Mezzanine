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
} from "lucide-react";
import Link from "next/link";
import { formatPercent, formatDateTime, SEVERITY_LABEL } from "@/lib/utils";

interface DashboardStats {
  totalPositions: number;
  topMovers: Mover[];
}

interface DbAlertItem {
  id: string;
  title: string;
  severity: string;
  createdAt: string;
  sourceUrl?: string;
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
  isActive: boolean;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [news, setNews] = useState<FeedItem[]>([]);
  const [disclosures, setDisclosures] = useState<FeedItem[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(false);
  const [alertList, setAlertList] = useState<UiAlert[]>([]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const posRes = await fetch("/api/positions");
      const positions = (await posRes.json()) as PositionSlim[];

      // 활성 종목 티커별 실시간 시세 (병렬)
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

      const [priceRes, dbAlertRes, feedRes] = await Promise.all([
        tickers.length
          ? fetch(`/api/prices?tickers=${tickers.join(",")}`).then((r) => r.json())
          : Promise.resolve({ quotes: {} }),
        fetch("/api/alerts?limit=20").then((r) => r.json()),
        tickers.length
          ? fetch(`/api/dashboard/feed?tickers=${tickerNameEntries}`).then((r) => r.json())
          : Promise.resolve({ news: [], disclosures: [], alerts: [] }),
      ]);

      const quotes = (priceRes as { quotes: Record<string, { price?: number; changeRate?: number }> })
        .quotes ?? {};

      // Movers: 활성 종목 + 방금 조회한 시세로 절대 등락률 기준 정렬
      const movers: Mover[] = positions
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
        })
        .sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0))
        .slice(0, 5);

      // 가격 기반 알림 계산: ±10% CRITICAL, ±5% WARNING (활성 종목 전체 대상)
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
            severity: rate >= 0 ? "WARNING" : "WARNING",
            title: `[${p.underlyingCompanyName}] 주가 ${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
            date: formatDateTime(new Date()),
            isoDate: nowIso,
            kind: "price",
            ticker: p.underlyingTicker,
            url: `/positions/${p.id}`,
          });
        }
      }

      // 공시 기반 알림 (feed API에서 계산됨)
      const feedData = feedRes as {
        news: FeedItem[];
        disclosures: FeedItem[];
        alerts: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; title: string; url?: string; date: string; isoDate: string; ticker: string }>;
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

      // DB 알림 (Alert 테이블에 저장된 것 — 스케줄러가 있으면 채워짐)
      const dbAlerts: UiAlert[] = (dbAlertRes as DbAlertItem[]).map((a) => ({
        severity: (["CRITICAL", "WARNING", "INFO"].includes(a.severity)
          ? a.severity
          : "INFO") as "CRITICAL" | "WARNING" | "INFO",
        title: a.title,
        url: a.sourceUrl,
        date: formatDateTime(a.createdAt),
        isoDate: a.createdAt,
        kind: "db",
      }));

      const merged = [...priceAlerts, ...disclosureAlerts, ...dbAlerts].sort((a, b) =>
        a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0,
      );

      setNews(feedData.news ?? []);
      setDisclosures(feedData.disclosures ?? []);
      setAlertList(merged);
      setFeedsLoading(false);

      setStats({
        totalPositions: positions.length,
        topMovers: movers,
      });
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setFeedsLoading(true);
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
            onClick={loadDashboard}
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 최근 알림 (긴급 + 경고 + 정보 병합, 시간 desc) */}
          <Card>
            <CardHeader>
              <CardTitle>최근 알림</CardTitle>
              <span className="text-xs text-gray-400">
                주가 ±5% · 전일/당일 공시 · 실적/보고서
              </span>
            </CardHeader>
            <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">불러오는 중...</div>
              ) : recent.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">알림이 없습니다</div>
              ) : (
                recent.map((alert, i) => {
                  const content = (
                    <div className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
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
                  return alert.url ? (
                    alert.url.startsWith("/") ? (
                      <Link key={i} href={alert.url}>
                        {content}
                      </Link>
                    ) : (
                      <a key={i} href={alert.url} target="_blank" rel="noopener noreferrer">
                        {content}
                      </a>
                    )
                  ) : (
                    <div key={i}>{content}</div>
                  );
                })
              )}
            </div>
          </Card>

          {/* 주가 변동 TOP 5 */}
          <Card>
            <CardHeader>
              <CardTitle>주가 변동 TOP 5</CardTitle>
              <Link href="/positions" className="text-xs text-[#0A2A5E] hover:underline">
                전체보기
              </Link>
            </CardHeader>
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">불러오는 중...</div>
              ) : !stats?.topMovers.length ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  등록된 종목이 없습니다.{" "}
                  <Link href="/positions/new" className="text-[#0A2A5E] hover:underline">
                    종목 등록하기
                  </Link>
                </div>
              ) : (
                stats.topMovers.map((mover) => {
                  const isRise = (mover.changeRate ?? 0) > 0;
                  const isFall = (mover.changeRate ?? 0) < 0;
                  const parity =
                    mover.currentPrice && mover.currentConversionPrice
                      ? (mover.currentPrice / mover.currentConversionPrice) * 100
                      : null;

                  return (
                    <Link
                      key={mover.id}
                      href={`/positions/${mover.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {mover.underlyingCompanyName}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{mover.assetName}</p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-semibold tabular-nums ${
                            isRise ? "text-rise" : isFall ? "text-fall" : "text-gray-600"
                          }`}
                        >
                          {mover.changeRate !== null ? (
                            <>
                              {isRise ? (
                                <TrendingUp className="inline h-3 w-3 mr-0.5" />
                              ) : isFall ? (
                                <TrendingDown className="inline h-3 w-3 mr-0.5" />
                              ) : null}
                              {formatPercent(mover.changeRate)}
                            </>
                          ) : (
                            "시세 없음"
                          )}
                        </p>
                        {parity !== null && (
                          <p className="text-xs text-gray-400 tabular-nums">
                            패리티 {parity.toFixed(0)}%
                          </p>
                        )}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
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
