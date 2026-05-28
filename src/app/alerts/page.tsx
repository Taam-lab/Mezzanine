"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime, SEVERITY_LABEL } from "@/lib/utils";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";

interface Alert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  body: string | null;
  sourceUrl: string | null;
  createdAt: string;
  position: { id: string; assetName: string; underlyingCompanyName: string } | null;
  userStatuses: Array<{ isRead: boolean }>;
}

const ALERT_TYPE_LABEL: Record<string, string> = {
  RISK: "리스크",
  NEWS: "뉴스",
  PRICE_MOVEMENT: "주가변동",
  DISCLOSURE: "공시",
  CONVERSION_PRICE_ADJUSTMENT: "전환가조정",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "WARNING" | "INFO">("ALL");

  async function loadAlerts() {
    setLoading(true);
    const res = await fetch("/api/alerts?limit=50");
    const data = await res.json();
    setAlerts(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function markAllRead() {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });
    await loadAlerts();
  }

  async function markRead(alertId: string) {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, action: "read" }),
    });
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId ? { ...a, userStatuses: [{ isRead: true }] } : a
      )
    );
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  const filtered =
    filter === "ALL" ? alerts : alerts.filter((a) => a.severity === filter);

  const severityBadge = (s: string): "critical" | "warning" | "info" => {
    if (s === "CRITICAL") return "critical";
    if (s === "WARNING") return "warning";
    return "info";
  };

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">알림함</h1>
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" />
            모두 읽음
          </Button>
        </div>

        {/* 필터 */}
        <div className="flex gap-2">
          {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                filter === level
                  ? "bg-[#0A2A5E] text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {level === "ALL" ? "전체" : SEVERITY_LABEL[level]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 text-center py-16">
            <Bell className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">알림이 없습니다</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50 overflow-hidden">
            {filtered.map((alert) => {
              const isRead = alert.userStatuses?.[0]?.isRead ?? false;
              return (
                <div
                  key={alert.id}
                  className={`px-5 py-4 flex items-start gap-4 ${
                    isRead ? "opacity-70" : "bg-blue-50/20"
                  }`}
                >
                  {!isRead && (
                    <div className="w-2 h-2 rounded-full bg-[#0A2A5E] mt-2 flex-shrink-0" />
                  )}
                  {isRead && <div className="w-2 flex-shrink-0" />}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-1">
                      <Badge variant={severityBadge(alert.severity)} className="flex-shrink-0">
                        {SEVERITY_LABEL[alert.severity]}
                      </Badge>
                      <Badge variant="neutral" className="flex-shrink-0 text-xs">
                        {ALERT_TYPE_LABEL[alert.alertType] || alert.alertType}
                      </Badge>
                    </div>
                    <p className={`text-sm ${isRead ? "text-gray-600" : "text-gray-900 font-medium"}`}>
                      {alert.title}
                    </p>
                    {alert.body && (
                      <p className="text-xs text-gray-500 mt-0.5">{alert.body}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-gray-400">{formatDateTime(alert.createdAt)}</span>
                      {alert.position && (
                        <Link
                          href={`/positions/${alert.position.id}`}
                          className="text-xs text-[#0A2A5E] hover:underline"
                        >
                          {alert.position.underlyingCompanyName}
                        </Link>
                      )}
                      {alert.sourceUrl && (
                        <a
                          href={alert.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          원문 보기 →
                        </a>
                      )}
                    </div>
                  </div>

                  {!isRead && (
                    <button
                      onClick={() => markRead(alert.id)}
                      className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                      읽음
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
