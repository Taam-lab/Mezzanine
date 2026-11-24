"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Pencil, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { VfAssetClass } from "@/lib/ventureFundParse";
import type { VfFundItem, VfHoldingItem } from "@/lib/ventureFundsQuery";
import UploadStatementsDialog from "./UploadStatementsDialog";

// ─── 표기 ───────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("ko-KR");
const won = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : nf.format(Math.round(n));
const eok = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "-"
    : `${(n / 1e8).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}억`;
const pct = (n: number | null, digits = 1) =>
  n === null || !Number.isFinite(n) ? "-" : `${n.toFixed(digits)}%`;
const signedPct = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const signedWon = (n: number | null) =>
  n === null ? "-" : `${n > 0 ? "+" : ""}${nf.format(Math.round(n))}`;
const pnlColor = (n: number | null) =>
  n === null || n === 0 ? "text-gray-700" : n > 0 ? "text-rise" : "text-fall";
const fmtPrice = (n: number | null) =>
  n === null ? "-" : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const fmtDate = (iso: string) => iso.replace(/-/g, ".");

// ─── 화면 묶음 ──────────────────────────────────────────────────────────────
//
// DB 에는 명세부의 종목별 원본(자산군 6종)을 그대로 두고, 화면에서만 세 덩어리로 묶는다.
//  - 채권: 메자닌(CB·EB·BW)과 일반 채권 — 종목별로 보여준다
//  - 주식: 합계 한 줄
//  - 기타자산: 예금·REPO·전단채·스왑·미수/미지급 등 나머지 전부 — 합계 한 줄

type ViewGroup = "BOND" | "STOCK" | "OTHER";

const VIEW_GROUPS: ViewGroup[] = ["BOND", "STOCK", "OTHER"];
const VIEW_LABEL: Record<ViewGroup, string> = { BOND: "채권", STOCK: "주식", OTHER: "기타자산" };

function viewGroupOf(c: VfAssetClass): ViewGroup {
  if (c === "MEZZ" || c === "BOND") return "BOND";
  if (c === "STOCK") return "STOCK";
  return "OTHER";
}

// ─── 집계 ───────────────────────────────────────────────────────────────────

interface Bucket {
  mv: number;
  acq: number;
  count: number;
}

interface FundSummary {
  byGroup: Record<ViewGroup, Bucket>;
  totalMv: number;
  /** 채권 + 주식 (손익을 보는 투자자산) */
  invested: Bucket;
  /** 비중의 분모. 순자산이 없으면 평가금액 합계. */
  base: number;
}

function emptyBucket(): Bucket {
  return { mv: 0, acq: 0, count: 0 };
}

function summarize(st: VfFundItem): FundSummary {
  const byGroup = { BOND: emptyBucket(), STOCK: emptyBucket(), OTHER: emptyBucket() };
  let totalMv = 0;
  for (const h of st.holdings) {
    const b = byGroup[viewGroupOf(h.assetClass)];
    b.mv += h.marketValue;
    b.acq += h.acquisitionAmount ?? 0;
    b.count += 1;
    totalMv += h.marketValue;
  }
  const invested = {
    mv: byGroup.BOND.mv + byGroup.STOCK.mv,
    acq: byGroup.BOND.acq + byGroup.STOCK.acq,
    count: byGroup.BOND.count + byGroup.STOCK.count,
  };
  return { byGroup, totalMv, invested, base: st.nav ?? totalMv };
}

function pnlOf(acq: number | null, mv: number): { pnl: number | null; rate: number | null } {
  if (!acq) return { pnl: null, rate: null };
  const pnl = mv - acq;
  return { pnl, rate: (pnl / acq) * 100 };
}

// ─── 화면 ───────────────────────────────────────────────────────────────────

export default function VentureFundsClient({ funds }: { funds: VfFundItem[] }) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fundId, setFundId] = useState<string | null>(null);

  const selected = funds.find((f) => f.id === fundId) ?? funds[0] ?? null;
  const summaries = useMemo(() => new Map(funds.map((f) => [f.id, summarize(f)])), [funds]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">코벤펀드</h1>
          <p className="text-xs text-gray-500 mt-1">
            코스닥벤처펀드 보유종목 · 펀드별 최신 신탁재산명세부 기준
          </p>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" />
          명세부 업로드
        </Button>
      </div>

      {funds.length === 0 ? (
        <Card className="border-dashed border-2 border-gray-200">
          <div className="text-center py-12 px-4">
            <FileSpreadsheet className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">아직 올린 명세부가 없습니다.</p>
            <p className="text-sm text-gray-500 mt-1 mb-5">
              월말에 받은 신탁재산명세부(.xlsx)를 올리면 펀드별 보유종목·보유금액·평가금액을
              보여줍니다. 여러 파일을 한 번에 올릴 수 있습니다.
            </p>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" />
              명세부 업로드
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <FundOverview
            funds={funds}
            summaries={summaries}
            selectedId={selected?.id ?? null}
            onSelect={(f) => setFundId(f.id)}
          />
          {selected && (
            <FundDetail
              key={`${selected.id}-${selected.baseDate}`}
              fund={selected}
              summary={summaries.get(selected.id)!}
            />
          )}
        </>
      )}

      {uploadOpen && (
        <UploadStatementsDialog
          funds={funds}
          onClose={() => setUploadOpen(false)}
          onSaved={() => {
            setUploadOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── 펀드 요약 표 ───────────────────────────────────────────────────────────

function FundOverview({
  funds,
  summaries,
  selectedId,
  onSelect,
}: {
  funds: VfFundItem[];
  summaries: Map<string, FundSummary>;
  selectedId: string | null;
  onSelect: (f: VfFundItem) => void;
}) {
  const totals = useMemo(() => {
    let nav = 0;
    const byGroup: Record<ViewGroup, number> = { BOND: 0, STOCK: 0, OTHER: 0 };
    for (const f of funds) {
      const sum = summaries.get(f.id)!;
      nav += sum.base;
      for (const g of VIEW_GROUPS) byGroup[g] += sum.byGroup[g].mv;
    }
    return { nav, byGroup };
  }, [funds, summaries]);

  const share = (v: number, base: number) => (base ? (v / base) * 100 : null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
              <th className="px-4 py-3 text-left whitespace-nowrap">펀드</th>
              <th className="px-4 py-3 text-left whitespace-nowrap">기준일</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">순자산</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">기준가</th>
              {VIEW_GROUPS.map((g) => (
                <th key={g} className="px-4 py-3 text-right whitespace-nowrap">
                  {VIEW_LABEL[g]}
                </th>
              ))}
              <th className="px-4 py-3 text-right whitespace-nowrap">채권 종목수</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {funds.map((f) => {
              const sum = summaries.get(f.id)!;
              const active = f.id === selectedId;
              return (
                <tr
                  key={f.id}
                  onClick={() => onSelect(f)}
                  aria-selected={active}
                  className={cn(
                    "cursor-pointer transition-colors",
                    active ? "bg-blue-50/60" : "hover:bg-gray-50",
                  )}
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "w-1 h-8 rounded-full",
                          active ? "bg-[#0A2A5E]" : "bg-transparent",
                        )}
                      />
                      <div>
                        <p className="font-medium text-gray-900">{f.name}</p>
                        <p className="text-xs text-gray-400">{f.manager ?? "운용사 미기재"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-700 whitespace-nowrap">
                    {fmtDate(f.baseDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">
                    {eok(sum.base)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700 whitespace-nowrap">
                    {f.navPerUnit === null ? "-" : fmtPrice(f.navPerUnit)}
                  </td>
                  {VIEW_GROUPS.map((g) => (
                    <ShareCell
                      key={g}
                      value={sum.byGroup[g].mv}
                      share={share(sum.byGroup[g].mv, sum.base)}
                    />
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700 whitespace-nowrap">
                    {sum.byGroup.BOND.count}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {funds.length > 1 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                <td className="px-4 py-3 text-gray-700" colSpan={2}>
                  합계 {funds.length}개 펀드
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900 whitespace-nowrap">
                  {eok(totals.nav)}
                </td>
                <td className="px-4 py-3" />
                {VIEW_GROUPS.map((g) => (
                  <ShareCell
                    key={g}
                    value={totals.byGroup[g]}
                    share={share(totals.byGroup[g], totals.nav)}
                  />
                ))}
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function ShareCell({ value, share }: { value: number; share: number | null }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
      {value === 0 ? (
        <span className="text-gray-300">-</span>
      ) : (
        <>
          <span className="text-gray-900">{eok(value)}</span>
          <span className="ml-1.5 text-xs text-gray-400">{pct(share)}</span>
        </>
      )}
    </td>
  );
}

// ─── 선택한 펀드 ────────────────────────────────────────────────────────────

function FundDetail({ fund: st, summary }: { fund: VfFundItem; summary: FundSummary }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(st.name);
  const [manager, setManager] = useState(st.manager ?? "");
  const [busy, setBusy] = useState(false);

  const invested = pnlOf(summary.invested.acq, summary.invested.mv);
  const bondShare = summary.base ? (summary.byGroup.BOND.mv / summary.base) * 100 : null;

  async function saveFund() {
    setBusy(true);
    try {
      const res = await fetch(`/api/venture-funds/${st.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, manager: manager.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? `저장 실패 (HTTP ${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteFund() {
    if (!confirm(`"${st.name}" 펀드와 보유종목을 삭제할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/venture-funds/${st.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? `삭제 실패 (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="펀드명"
              className="h-9 px-3 text-sm border border-gray-300 rounded-lg w-64 focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
            />
            <input
              value={manager}
              onChange={(e) => setManager(e.target.value)}
              placeholder="운용사"
              aria-label="운용사"
              className="h-9 px-3 text-sm border border-gray-300 rounded-lg w-40 focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
            />
            <Button size="sm" onClick={saveFund} loading={busy} disabled={!name.trim()}>
              저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              취소
            </Button>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-bold text-gray-900">{st.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {[st.manager, `기준일 ${fmtDate(st.baseDate)}`, st.sourceFileName]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              펀드명 수정
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={deleteFund}
              disabled={busy}
              className="text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              펀드 삭제
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="순자산"
          value={eok(summary.base)}
          sub={st.navPerUnit === null ? undefined : `기준가 ${fmtPrice(st.navPerUnit)}`}
        />
        <Kpi
          label="보유금액 (취득원가)"
          value={eok(summary.invested.acq)}
          sub="채권 + 주식"
        />
        <Kpi
          label="평가금액"
          value={eok(summary.invested.mv)}
          sub={
            <span className={pnlColor(invested.pnl)}>
              {invested.pnl === null ? "-" : `${invested.pnl > 0 ? "+" : ""}${eok(invested.pnl)}`}{" "}
              ({signedPct(invested.rate)})
            </span>
          }
        />
        <Kpi
          label="채권 비중"
          value={pct(bondShare)}
          sub={`${summary.byGroup.BOND.count}종목 · ${eok(summary.byGroup.BOND.mv)}`}
        />
      </div>

      <HoldingsTable fund={st} summary={summary} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500 tabular-nums">{sub}</p>}
    </Card>
  );
}

// ─── 보유종목 표 ────────────────────────────────────────────────────────────

const TD = "px-4 py-2.5 text-right tabular-nums whitespace-nowrap";

function HoldingsTable({ fund: st, summary }: { fund: VfFundItem; summary: FundSummary }) {
  const bonds = useMemo(
    () =>
      st.holdings
        .filter((h) => viewGroupOf(h.assetClass) === "BOND")
        .sort((a, b) => b.marketValue - a.marketValue),
    [st.holdings],
  );
  // 기타자산에 무엇이 묶였는지 — 명세부의 자산구분 원문을 그대로 나열한다.
  const otherKinds = useMemo(
    () =>
      Array.from(
        new Set(
          st.holdings
            .filter((h) => viewGroupOf(h.assetClass) === "OTHER")
            .map((h) => h.assetClassRaw),
        ),
      ).join(" · "),
    [st.holdings],
  );
  const weight = (v: number) => (summary.base ? (v / summary.base) * 100 : null);
  const gap = st.nav === null ? 0 : st.nav - summary.totalMv;
  const bond = summary.byGroup.BOND;
  const stock = summary.byGroup.STOCK;
  const other = summary.byGroup.OTHER;
  const bondPnl = pnlOf(bond.acq, bond.mv);
  const stockPnl = pnlOf(stock.acq, stock.mv);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
              <th className="px-4 py-3 text-left whitespace-nowrap">종목</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">액면</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">단가</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">보유금액</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">평가금액</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">평가손익</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">수익률</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">비중</th>
            </tr>
          </thead>

          {bonds.length > 0 && (
            <tbody className="divide-y divide-gray-50">
              <tr className="bg-gray-50/70 border-t border-gray-100 font-semibold text-gray-700">
                <td className="px-4 py-2 whitespace-nowrap" colSpan={3}>
                  채권
                  <span className="ml-1.5 text-xs font-normal text-gray-400">{bonds.length}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{won(bond.acq)}</td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{won(bond.mv)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums whitespace-nowrap", pnlColor(bondPnl.pnl))}>
                  {signedWon(bondPnl.pnl)}
                </td>
                <td className={cn("px-4 py-2 text-right tabular-nums whitespace-nowrap", pnlColor(bondPnl.pnl))}>
                  {signedPct(bondPnl.rate)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {pct(weight(bond.mv))}
                </td>
              </tr>
              {bonds.map((h) => (
                <BondRow key={h.id} h={h} weight={weight(h.marketValue)} />
              ))}
            </tbody>
          )}

          <tbody className="divide-y divide-gray-50 border-t border-gray-100">
            {stock.count > 0 && (
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3" colSpan={3}>
                  <span className="font-semibold text-gray-700">주식</span>
                  <span className="ml-1.5 text-xs text-gray-400">{stock.count}종목 합계</span>
                </td>
                <td className={cn(TD, "text-gray-700")}>{won(stock.acq)}</td>
                <td className={cn(TD, "font-medium text-gray-900")}>{won(stock.mv)}</td>
                <td className={cn(TD, pnlColor(stockPnl.pnl))}>{signedWon(stockPnl.pnl)}</td>
                <td className={cn(TD, pnlColor(stockPnl.pnl))}>{signedPct(stockPnl.rate)}</td>
                <td className={cn(TD, "text-gray-700")}>{pct(weight(stock.mv))}</td>
              </tr>
            )}
            {other.count > 0 && (
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3" colSpan={3}>
                  <span className="font-semibold text-gray-700">기타자산</span>
                  {otherKinds && (
                    <p className="text-xs text-gray-400 mt-0.5">{otherKinds}</p>
                  )}
                </td>
                <td className={cn(TD, "text-gray-400")}>-</td>
                <td className={cn(TD, "font-medium text-gray-900")}>{won(other.mv)}</td>
                <td className={cn(TD, "text-gray-400")}>-</td>
                <td className={cn(TD, "text-gray-400")}>-</td>
                <td className={cn(TD, "text-gray-700")}>{pct(weight(other.mv))}</td>
              </tr>
            )}
          </tbody>

          <tfoot className="border-t-2 border-gray-200">
            <tr className="font-semibold text-gray-900">
              <td className="px-4 py-3" colSpan={4}>
                평가금액 합계
              </td>
              <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                {won(summary.totalMv)}
              </td>
              <td className="px-4 py-3" colSpan={2} />
              <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                {pct(weight(summary.totalMv))}
              </td>
            </tr>
            {st.nav !== null && gap !== 0 && (
              <tr className="text-gray-500">
                <td className="px-4 py-2" colSpan={4}>
                  명세부에 없는 부채 등
                  <span className="ml-1.5 text-xs text-gray-400">(순자산 − 평가금액 합계)</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{won(gap)}</td>
                <td className="px-4 py-2" colSpan={2} />
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {pct(weight(gap))}
                </td>
              </tr>
            )}
            {st.nav !== null && (
              <tr className="font-semibold text-gray-900 bg-gray-50">
                <td className="px-4 py-3" colSpan={4}>
                  순자산
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{won(st.nav)}</td>
                <td className="px-4 py-3" colSpan={2} />
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">100.0%</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BondRow({ h, weight }: { h: VfHoldingItem; weight: number | null }) {
  const { pnl, rate } = pnlOf(h.acquisitionAmount, h.marketValue);
  const meta = [h.code, h.category, h.maturityDate && `만기 ${fmtDate(h.maturityDate)}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 min-w-[220px]">
        <div className="flex items-center gap-1.5">
          {h.mezzType && (
            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-[#e55a25] border border-orange-100">
              {h.mezzType}
            </span>
          )}
          {h.positionId ? (
            <Link
              href={`/positions/${h.positionId}`}
              className="font-medium text-[#0A2A5E] hover:underline"
              title="보유 종목 상세 보기"
            >
              {h.name}
            </Link>
          ) : (
            <span className="font-medium text-gray-900">{h.name}</span>
          )}
        </div>
        {meta && <p className="text-xs text-gray-400 mt-0.5">{meta}</p>}
      </td>
      <td className={cn(TD, "text-gray-700")}>{h.quantity ? won(h.quantity) : "-"}</td>
      <td className={cn(TD, "text-gray-700")}>{fmtPrice(h.price)}</td>
      <td className={cn(TD, "text-gray-700")}>
        {h.acquisitionAmount ? won(h.acquisitionAmount) : "-"}
      </td>
      <td className={cn(TD, "font-medium text-gray-900")}>{won(h.marketValue)}</td>
      <td className={cn(TD, pnlColor(pnl))}>{signedWon(pnl)}</td>
      <td className={cn(TD, pnlColor(pnl))}>{signedPct(rate)}</td>
      <td className={cn(TD, "text-gray-700")}>{pct(weight)}</td>
    </tr>
  );
}
