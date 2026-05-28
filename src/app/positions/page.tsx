"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Plus, TrendingUp, TrendingDown, Search } from "lucide-react";
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
  isActive: boolean;
  priceSnapshots: Array<{ price: number; changeRate: number; snapshotAt: string }>;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/positions")
      .then((r) => r.json())
      .then((data) => {
        setPositions(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, []);

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
          <Link href="/positions/new">
            <Button variant="primary" size="sm">
              <Plus className="h-4 w-4" />
              종목 등록
            </Button>
          </Link>
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
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">패리티</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">만기일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((pos) => {
                    const latest = pos.priceSnapshots?.[0];
                    const isRise = (latest?.changeRate ?? 0) > 0;
                    const isFall = (latest?.changeRate ?? 0) < 0;
                    const parity =
                      latest?.price && pos.currentConversionPrice
                        ? (latest.price / pos.currentConversionPrice) * 100
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
                          {latest ? formatKRW(latest.price) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {latest ? (
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
                              {formatPercent(latest.changeRate)}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
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
                          {formatDate(pos.maturityDate)}
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
