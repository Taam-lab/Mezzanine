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
} from "lucide-react";
import Link from "next/link";
import { formatKRW, formatPercent, formatDateTime, SEVERITY_LABEL } from "@/lib/utils";

interface DashboardStats {
  totalPositions: number;
  criticalAlerts: number;
  warningAlerts: number;
  infoAlerts: number;
  unreadAlerts: number;
  recentAlerts: AlertItem[];
  topMovers: Mover[];
}

interface AlertItem {
  id: string;
  title: string;
  severity: string;
  createdAt: string;
  position?: { assetName: string };
}

interface Mover {
  id: string;
  assetName: string;
  underlyingCompanyName: string;
  changeRate: number | null;
  currentPrice: number | null;
  currentConversionPrice: number | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [posRes, alertRes] = await Promise.all([
        fetch("/api/positions"),
        fetch("/api/alerts?limit=10"),
      ]);
      const positions = await posRes.json();
      const alerts = await alertRes.json();

      const criticalAlerts = alerts.filter((a: AlertItem) => a.severity === "CRITICAL").length;
      const warningAlerts = alerts.filter((a: AlertItem) => a.severity === "WARNING").length;
      const infoAlerts = alerts.filter((a: AlertItem) => a.severity === "INFO").length;

      const unreadRes = await fetch("/api/alerts?unreadOnly=true&countOnly=true");
      const { count } = await unreadRes.json();

      const movers: Mover[] = positions
        .map((p: {
          id: string;
          assetName: string;
          underlyingCompanyName: string;
          currentConversionPrice: number | null;
          priceSnapshots?: Array<{ price: number; changeRate: number }>;
        }) => ({
          id: p.id,
          assetName: p.assetName,
          underlyingCompanyName: p.underlyingCompanyName,
          changeRate: p.priceSnapshots?.[0]?.changeRate ?? null,
          currentPrice: p.priceSnapshots?.[0]?.price ?? null,
          currentConversionPrice: p.currentConversionPrice,
        }))
        .sort((a: Mover, b: Mover) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0))
        .slice(0, 5);

      setStats({
        totalPositions: positions.length,
        criticalAlerts,
        warningAlerts,
        infoAlerts,
        unreadAlerts: count,
        recentAlerts: alerts.slice(0, 8),
        topMovers: movers,
      });
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
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
                  {stats?.criticalAlerts ?? "-"}
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
                  {stats?.warningAlerts ?? "-"}
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
                <p className="text-xs text-gray-500">미확인 알림</p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">
                  {stats?.unreadAlerts ?? "-"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 최근 알림 */}
          <Card>
            <CardHeader>
              <CardTitle>최근 알림</CardTitle>
              <Link href="/alerts" className="text-xs text-[#0A2A5E] hover:underline">
                전체보기
              </Link>
            </CardHeader>
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">불러오는 중...</div>
              ) : !stats?.recentAlerts.length ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">알림이 없습니다</div>
              ) : (
                stats.recentAlerts.map((alert) => (
                  <div key={alert.id} className="px-5 py-3 flex items-start gap-3">
                    <Badge variant={severityBadge(alert.severity)} className="mt-0.5 flex-shrink-0">
                      {SEVERITY_LABEL[alert.severity]}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{alert.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(alert.createdAt)}</p>
                    </div>
                  </div>
                ))
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
                              {isRise ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : isFall ? <TrendingDown className="inline h-3 w-3 mr-0.5" /> : null}
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
