"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Search,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Filter,
} from "lucide-react";
import {
  formatKRW,
  formatPercent,
  formatDate,
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

type SortDir = "asc" | "desc";
type ColKind = "text" | "enum" | "number" | "date";

interface ColumnDef {
  key: string;
  label: string;
  kind: ColKind;
  align?: "left" | "center" | "right";
  enumOptions?: Array<{ value: string; label: string }>;
  /** 이 컬럼의 filter 값을 갖고 있는 position이 통과하는지 (텍스트) */
}

const COLUMNS: ColumnDef[] = [
  { key: "assetName", label: "종목명", kind: "text", align: "left" },
  { key: "underlyingCompanyName", label: "기초자산", kind: "text", align: "left" },
  {
    key: "mezzanineType",
    label: "형태",
    kind: "enum",
    align: "center",
    enumOptions: [
      { value: "CB", label: "CB" },
      { value: "BW", label: "BW" },
      { value: "EB", label: "EB" },
      { value: "RCPS", label: "RCPS" },
      { value: "COMMON", label: "보통주" },
    ],
  },
  {
    key: "investmentType",
    label: "투자구분",
    kind: "enum",
    align: "center",
    enumOptions: [
      { value: "DIRECT", label: INVESTMENT_TYPE_LABEL.DIRECT ?? "직접" },
      { value: "INDIRECT", label: INVESTMENT_TYPE_LABEL.INDIRECT ?? "간접" },
    ],
  },
  { key: "investmentAmount", label: "투자금액", kind: "number", align: "right" },
  { key: "currentPrice", label: "현재가", kind: "number", align: "right" },
  { key: "changeRate", label: "등락률", kind: "number", align: "right" },
  { key: "currentConversionPrice", label: "전환/교환가액", kind: "number", align: "right" },
  { key: "parity", label: "패리티", kind: "number", align: "right" },
  { key: "issueDate", label: "발행일", kind: "date", align: "center" },
  { key: "nextPut", label: "다음 Put", kind: "date", align: "center" },
  { key: "maturityDate", label: "만기일", kind: "date", align: "center" },
];

interface DerivedRow extends Position {
  __currentPrice: number | null;
  __changeRate: number | null;
  __parity: number | null;
  __nextPutStart: number | null; // ms epoch, 정렬용
}

/** 정렬 시 null/undefined는 항상 끝으로 밀리게. */
function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const aNull = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bNull = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1; // null → 끝
  if (bNull) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b), "ko");
  return dir === "asc" ? cmp : -cmp;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [livePrices, setLivePrices] = useState<Record<string, LiveQuote>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // filters: text → 문자열, enum → 선택된 값 배열 (빈배열이면 미필터)
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);

  // 필터 팝오버 외부 클릭 시 닫기
  useEffect(() => {
    if (!openFilter) return;
    function onDown(e: MouseEvent) {
      if (!headerRef.current) return;
      if (!headerRef.current.contains(e.target as Node)) setOpenFilter(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openFilter]);

  function toggleSort(col: string) {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortCol(null);
    }
  }

  function clearFilter(col: string) {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
  }

  const [reparsingAll, setReparsingAll] = useState(false);
  async function reparseAllPositions() {
    if (
      !confirm(
        "모든 활성 종목의 저장된 DART 원문을 다시 파싱해 풋/콜 옵션 필드를 갱신합니다. 종목 수에 따라 수십 초 걸릴 수 있음. 계속?",
      )
    )
      return;
    setReparsingAll(true);
    try {
      const res = await fetch("/api/positions/reparse-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(`전체 재파싱 실패: ${data.error ?? res.status}`);
        return;
      }
      const failed = (data.results ?? [])
        .filter((r: { ok: boolean }) => !r.ok)
        .map((r: { assetName: string; error: string }) => `${r.assetName}: ${r.error}`)
        .slice(0, 8)
        .join("\n");
      alert(
        `전체 재파싱 완료 — 성공 ${data.ok}/${data.total}${
          data.failed ? `, 실패 ${data.failed}` : ""
        }${failed ? `\n\n실패 종목:\n${failed}` : ""}`,
      );
      sessionStorage.removeItem("positionsList");
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "네트워크 오류");
    } finally {
      setReparsingAll(false);
    }
  }

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

  // 각 행에 정렬용 파생값 붙임
  const derived: DerivedRow[] = useMemo(() => {
    return positions.map((p) => {
      const live = livePrices[p.underlyingTicker];
      const price = live?.price ?? null;
      const changeRate = live?.changeRate ?? null;
      const parity =
        price !== null && p.currentConversionPrice
          ? (price / p.currentConversionPrice) * 100
          : null;
      let nextPutStart: number | null = null;
      if (p.putOptionSchedule) {
        try {
          const rows = JSON.parse(p.putOptionSchedule) as Array<{ from: string; to: string }>;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          for (const r of rows) {
            if (today > new Date(r.to)) continue;
            nextPutStart = new Date(r.from).getTime();
            break;
          }
        } catch {
          // ignore
        }
      }
      if (nextPutStart === null && p.putOptionStartDate) {
        nextPutStart = new Date(p.putOptionStartDate).getTime();
      }
      return {
        ...p,
        __currentPrice: price,
        __changeRate: changeRate,
        __parity: parity,
        __nextPutStart: nextPutStart,
      };
    });
  }, [positions, livePrices]);

  // 필터 적용
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return derived.filter((p) => {
      // 상단 검색어
      if (q) {
        const hit =
          p.assetName.toLowerCase().includes(q) ||
          p.underlyingCompanyName.toLowerCase().includes(q) ||
          p.underlyingTicker.includes(search);
        if (!hit) return false;
      }
      // 컬럼 필터
      for (const [col, f] of Object.entries(filters)) {
        if (typeof f === "string" && f.trim()) {
          const term = f.toLowerCase();
          let target = "";
          if (col === "assetName") target = p.assetName.toLowerCase();
          else if (col === "underlyingCompanyName")
            target = `${p.underlyingCompanyName} ${p.underlyingTicker}`.toLowerCase();
          if (!target.includes(term)) return false;
        } else if (Array.isArray(f) && f.length > 0) {
          const val = (p as unknown as Record<string, string>)[col];
          if (!f.includes(val)) return false;
        }
      }
      return true;
    });
  }, [derived, filters, search]);

  // 정렬 적용
  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const getValue = (p: DerivedRow): unknown => {
      switch (sortCol) {
        case "assetName":
          return p.assetName;
        case "underlyingCompanyName":
          return p.underlyingCompanyName;
        case "mezzanineType":
          return p.mezzanineType;
        case "investmentType":
          return p.investmentType;
        case "investmentAmount":
          return p.investmentAmount ? Number(p.investmentAmount) : null;
        case "currentPrice":
          return p.__currentPrice;
        case "changeRate":
          return p.__changeRate;
        case "currentConversionPrice":
          return p.currentConversionPrice;
        case "parity":
          return p.__parity;
        case "issueDate":
          return p.issueDate ? new Date(p.issueDate).getTime() : null;
        case "nextPut":
          return p.__nextPutStart;
        case "maturityDate":
          return p.maturityDate ? new Date(p.maturityDate).getTime() : null;
        default:
          return null;
      }
    };
    return [...filtered].sort((a, b) => compareValues(getValue(a), getValue(b), sortDir));
  }, [filtered, sortCol, sortDir]);

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
              onClick={reparseAllPositions}
              disabled={reparsingAll || positions.length === 0}
              title="모든 종목 저장된 DART 원문 재파싱 (풋/콜 옵션 필드만)"
            >
              {reparsingAll ? "재파싱 중..." : "전체 재파싱"}
            </Button>
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
        ) : sorted.length === 0 ? (
          <Card className="border-dashed border-2 border-gray-200">
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">
                {search || Object.keys(filters).length > 0
                  ? "검색/필터 결과가 없습니다."
                  : "등록된 종목이 없습니다."}
              </p>
              {!search && Object.keys(filters).length === 0 && (
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
                <thead ref={headerRef}>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {COLUMNS.map((col) => {
                      const filterActive =
                        (typeof filters[col.key] === "string" &&
                          (filters[col.key] as string).trim().length > 0) ||
                        (Array.isArray(filters[col.key]) &&
                          (filters[col.key] as string[]).length > 0);
                      const isSorted = sortCol === col.key;
                      const alignClass =
                        col.align === "right"
                          ? "justify-end"
                          : col.align === "center"
                            ? "justify-center"
                            : "justify-start";
                      const canFilter = col.kind === "text" || col.kind === "enum";
                      return (
                        <th
                          key={col.key}
                          className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide relative whitespace-nowrap"
                        >
                          <div className={`flex items-center gap-1 ${alignClass}`}>
                            <button
                              type="button"
                              onClick={() => toggleSort(col.key)}
                              className="flex items-center gap-1 hover:text-[#0A2A5E]"
                              title="클릭하여 정렬"
                            >
                              <span>{col.label}</span>
                              {isSorted ? (
                                sortDir === "asc" ? (
                                  <ArrowUp className="h-3 w-3 text-[#0A2A5E]" />
                                ) : (
                                  <ArrowDown className="h-3 w-3 text-[#0A2A5E]" />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 text-gray-300" />
                              )}
                            </button>
                            {canFilter && (
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenFilter(openFilter === col.key ? null : col.key)
                                }
                                className={`p-0.5 rounded hover:bg-gray-200 ${
                                  filterActive ? "text-[#0A2A5E]" : "text-gray-300"
                                }`}
                                title="필터"
                              >
                                <Filter className="h-3 w-3" />
                              </button>
                            )}
                          </div>

                          {openFilter === col.key && canFilter && (
                            <div className="absolute top-full mt-1 left-0 z-40 min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 normal-case font-normal">
                              {col.kind === "text" ? (
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={(filters[col.key] as string) ?? ""}
                                    onChange={(e) =>
                                      setFilters((prev) => ({
                                        ...prev,
                                        [col.key]: e.target.value,
                                      }))
                                    }
                                    placeholder="포함할 텍스트..."
                                    className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-[#0A2A5E]"
                                  />
                                  <div className="flex justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => clearFilter(col.key)}
                                      className="text-xs text-gray-500 hover:text-gray-700"
                                    >
                                      필터 해제
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setOpenFilter(null)}
                                      className="text-xs text-[#0A2A5E] font-medium"
                                    >
                                      닫기
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  {col.enumOptions!.map((opt) => {
                                    const arr = (filters[col.key] as string[]) ?? [];
                                    const checked = arr.includes(opt.value);
                                    return (
                                      <label
                                        key={opt.value}
                                        className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            setFilters((prev) => {
                                              const cur = (prev[col.key] as string[]) ?? [];
                                              const next = e.target.checked
                                                ? [...cur, opt.value]
                                                : cur.filter((v) => v !== opt.value);
                                              const clone = { ...prev };
                                              if (next.length === 0) delete clone[col.key];
                                              else clone[col.key] = next;
                                              return clone;
                                            });
                                          }}
                                          className="rounded accent-[#0A2A5E]"
                                        />
                                        <span>{opt.label}</span>
                                      </label>
                                    );
                                  })}
                                  <div className="flex justify-between gap-2 pt-2 border-t border-gray-100">
                                    <button
                                      type="button"
                                      onClick={() => clearFilter(col.key)}
                                      className="text-xs text-gray-500 hover:text-gray-700"
                                    >
                                      필터 해제
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setOpenFilter(null)}
                                      className="text-xs text-[#0A2A5E] font-medium"
                                    >
                                      닫기
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </th>
                      );
                    })}
                    <th className="px-2 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sorted.map((pos) => {
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
