"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Plus, TrendingUp, TrendingDown, Search, Trash2 } from "lucide-react";
import {
  formatKRW,
  formatPercent,
  formatDate,
  MEZZANINE_TYPE_LABEL,
  INVESTMENT_TYPE_LABEL,
} from "@/lib/utils";

interface Position {
  id: string;
  bondCode: string | null;
  assetName: string;
  underlyingTicker: string;
  underlyingCompanyName: string;
  underlyingMarket: string;
  mezzanineType: string;
  investmentType: string;
  investmentAmount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  currentConversionPrice: number | null;
  putOptionStartDate: string | null;
  putOptionEndDate: string | null;
  putOptionSchedule: string | null;
  isActive: boolean;
}

/**
 * 조기상환청구권 다음 행사가능 회차 표기.
 * 오늘 날짜가 회차 [from, to] 범위 안에 있으면 exercisable=true → 셀 색상을 빨간색으로.
 */
function nextPutWindow(
  scheduleJson: string | null,
  startIso: string | null,
  endIso: string | null,
): { text: string; exercisable: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fmt = (iso: string) => iso.slice(0, 10);

  if (scheduleJson) {
    try {
      const rows = JSON.parse(scheduleJson) as Array<{ from: string; to: string }>;
      if (Array.isArray(rows) && rows.length > 0) {
        for (const row of rows) {
          const from = new Date(row.from);
          const to = new Date(row.to);
          if (today > to) continue;
          const exercisable = today >= from && today <= to;
          return { text: `${fmt(row.from)} ~ ${fmt(row.to)}`, exercisable };
        }
        return { text: "종료", exercisable: false };
      }
    } catch {
      // fall through
    }
  }
  if (!startIso || !endIso) return { text: "-", exercisable: false };
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (today < start) return { text: `${fmt(startIso)} ~ ${fmt(endIso)}`, exercisable: false };
  if (today <= end) return { text: `현재 ~ ${fmt(endIso)}`, exercisable: true };
  return { text: "종료", exercisable: false };
}

interface LiveQuote {
  price: number;
  changeRate: number;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [livePrices, setLivePrices] = useState<Record<string, LiveQuote>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function refreshLivePricesByTickers(tickers: string[]) {
    const uniq = Array.from(new Set(tickers.filter((t) => /^\d{6}$/.test(t))));
    if (uniq.length === 0) return;
    setRefreshing(true);
    setPriceError(null);
    try {
      // save=false: DB 스냅샷 스킵 → 응답 시간 반토막
      // t=Date.now(): 브라우저/CDN 캐시 무시하고 매 호출마다 fresh 응답
      const res = await fetch(`/api/prices?tickers=${uniq.join(",")}&save=false&t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setPriceError(data.error || `시세 조회 실패 (HTTP ${res.status})`);
        return;
      }
      const quotes = (data as {
        quotes: Record<string, { price?: number; changeRate?: number; error?: string }>;
      }).quotes;
      const next: Record<string, LiveQuote> = {};
      const failed: string[] = [];
      for (const [t, q] of Object.entries(quotes)) {
        if (typeof q.price === "number") {
          next[t] = { price: q.price, changeRate: q.changeRate ?? 0 };
        } else if (q.error) {
          failed.push(`${t}: ${q.error}`);
        }
      }
      setLivePrices(next);
      if (failed.length > 0 && Object.keys(next).length === 0) {
        setPriceError(failed.slice(0, 3).join(" / "));
      }
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : "네트워크 오류");
    } finally {
      setRefreshing(false);
    }
  }

  async function deletePosition(id: string, assetName: string) {
    if (!confirm(`"${assetName}" 종목을 삭제하시겠습니까?\n관련 스냅샷·공시·뉴스·알림·이력 데이터도 모두 함께 영구 삭제됩니다.`)) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/positions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `삭제 실패 (HTTP ${res.status})`);
        return;
      }
      setPositions((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "네트워크 오류");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    // 재방문 시 이전 목록 스냅샷을 sessionStorage에서 즉시 hydrate → 화면 바로 뜸
    // 티커 캐시로 시세 조회도 병렬 시작.
    if (typeof window !== "undefined") {
      const cachedList = sessionStorage.getItem("positionsList");
      if (cachedList) {
        try {
          const list = JSON.parse(cachedList) as Position[];
          if (Array.isArray(list) && list.length > 0) {
            setPositions(list);
            setLoading(false);
            refreshLivePricesByTickers(list.map((p) => p.underlyingTicker));
          }
        } catch {
          // ignore
        }
      }
    }

    fetch("/api/positions", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setPositions(list);
        setLoading(false);
        try {
          sessionStorage.setItem("positionsList", JSON.stringify(list));
        } catch {
          // storage full 등 무시
        }
        const tickers = list.map((p: Position) => p.underlyingTicker);
        if (tickers.length > 0) {
          refreshLivePricesByTickers(tickers);
        }
      });
  }, []);

  useEffect(() => {
    if (positions.length === 0) return;
    const id = setInterval(
      () => refreshLivePricesByTickers(positions.map((p) => p.underlyingTicker)),
      60_000,
    );
    return () => clearInterval(id);
  }, [positions]);

  const filtered = positions.filter(
    (p) =>
      p.assetName.toLowerCase().includes(search.toLowerCase()) ||
      p.underlyingCompanyName.toLowerCase().includes(search.toLowerCase()) ||
      p.underlyingTicker.includes(search)
  );

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">보유 종목</h1>
          <div className="flex items-center gap-2">
            {priceError && (
              <span
                className="text-xs text-red-500 max-w-md truncate"
                title={priceError}
              >
                시세 조회 실패
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshLivePricesByTickers(positions.map((p) => p.underlyingTicker))}
              disabled={refreshing || positions.length === 0}
              title="실시간 시세 새로고침"
            >
              {refreshing ? "새로고침 중..." : "시세 새로고침"}
            </Button>
            <Link href="/positions/new">
              <Button variant="primary" size="sm">
                <Plus className="h-4 w-4" />
                종목 등록
              </Button>
            </Link>
          </div>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="종목명, 회사명, 종목코드 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed border-2 border-gray-200">
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">
                {search ? "검색 결과가 없습니다." : "등록된 종목이 없습니다."}
              </p>
              {!search && (
                <Link href="/positions/new">
                  <Button variant="primary">
                    <Plus className="h-4 w-4" />
                    첫 번째 종목 등록하기
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">종목명</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">기초자산</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">형태</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">투자구분</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">투자금액</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">현재가</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">등락률</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">전환/교환가액</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">패리티</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">발행일</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">다음 Put</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">만기일</th>
                    <th className="px-2 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((pos) => {
                    const live = livePrices[pos.underlyingTicker];
                    const price = live?.price;
                    const changeRate = live?.changeRate ?? 0;
                    const isRise = changeRate > 0;
                    const isFall = changeRate < 0;
                    const parity =
                      price && pos.currentConversionPrice
                        ? (price / pos.currentConversionPrice) * 100
                        : null;

                    return (
                      <tr
                        key={pos.id}
                        className="hover:bg-blue-50/30 transition-colors cursor-pointer"
                        onClick={() => (window.location.href = `/positions/${pos.id}`)}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-gray-900">{pos.assetName}</p>
                            {pos.bondCode && (
                              <p className="text-xs text-gray-400">{pos.bondCode}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-gray-900">{pos.underlyingCompanyName}</p>
                            <p className="text-xs text-gray-400">
                              {pos.underlyingTicker} · {pos.underlyingMarket}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="neutral">{pos.mezzanineType}</Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs text-gray-600">
                            {INVESTMENT_TYPE_LABEL[pos.investmentType] || pos.investmentType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm text-gray-900">
                          {pos.investmentAmount
                            ? formatKRW(Number(pos.investmentAmount))
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm font-medium text-gray-900">
                          {price ? formatKRW(price) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {price !== undefined ? (
                            <span
                              className={`tabular-nums text-sm font-semibold flex items-center justify-end gap-0.5 ${
                                isRise ? "text-rise" : isFall ? "text-fall" : "text-gray-500"
                              }`}
                            >
                              {isRise ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : isFall ? (
                                <TrendingDown className="h-3 w-3" />
                              ) : null}
                              {formatPercent(changeRate)}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm text-gray-900">
                          {pos.currentConversionPrice ? formatKRW(pos.currentConversionPrice) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm">
                          {parity !== null ? (
                            <span
                              className={`font-medium ${
                                parity >= 100 ? "text-green-600" : parity >= 80 ? "text-yellow-600" : "text-red-600"
                              }`}
                            >
                              {parity.toFixed(0)}%
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-gray-600">
                          {formatDate(pos.issueDate)}
                        </td>
                        {(() => {
                          const put = nextPutWindow(
                            pos.putOptionSchedule,
                            pos.putOptionStartDate,
                            pos.putOptionEndDate,
                          );
                          return (
                            <td
                              className={`px-4 py-3 text-center tabular-nums text-xs whitespace-nowrap ${
                                put.exercisable
                                  ? "text-red-600 font-semibold"
                                  : "text-gray-600"
                              }`}
                            >
                              {put.text}
                            </td>
                          );
                        })()}
                        <td className="px-4 py-3 text-center text-sm text-gray-600">
                          {formatDate(pos.maturityDate)}
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePosition(pos.id, pos.assetName);
                            }}
                            disabled={deletingId === pos.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="종목 삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
