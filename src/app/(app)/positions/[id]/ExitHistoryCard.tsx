"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  cn,
  formatDate,
  formatKRW,
  formatKRWShort,
  parseKrwInput,
  EXIT_METHODS,
} from "@/lib/utils";
import type { PositionDetail } from "@/lib/positionDetailQuery";

type Exit = PositionDetail["exits"][number];

const pnlColor = (n: number | null) =>
  n === null || n === 0 ? "text-gray-700" : n > 0 ? "text-rise" : "text-fall";
const signed = (n: number, fmt: (v: number) => string) => `${n > 0 ? "+" : ""}${fmt(n)}`;

/** KST 오늘 "YYYY-MM-DD" — 폼 기본값. */
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 부분 Exit 이력. 투자원금 중 먼저 회수한 금액을 기록하고 잔여 원금을 보여준다.
 * 예: 네오이뮨텍 투자원금 20억 중 2억 Exit → 잔여 18억.
 *
 * Exit 원금은 투자원금(액면) 기준이고, 회수금액은 실제로 받은 돈이다 (전환 후 매도라면
 * 매도대금). 둘 다 있으면 실현손익 = 회수금액 − Exit 원금.
 */
export default function ExitHistoryCard({
  positionId,
  investmentAmount,
  exits,
}: {
  positionId: string;
  investmentAmount: string | null;
  exits: Exit[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const invested = investmentAmount === null ? null : Number(investmentAmount);
  const exited = exits.reduce((s, e) => s + Number(e.principalAmount), 0);
  const remaining = invested === null ? null : invested - exited;
  const withProceeds = exits.filter((e) => e.proceedsAmount !== null);
  const proceeds = withProceeds.reduce((s, e) => s + Number(e.proceedsAmount), 0);
  const proceedsBase = withProceeds.reduce((s, e) => s + Number(e.principalAmount), 0);
  const realized = withProceeds.length > 0 ? proceeds - proceedsBase : null;
  const exitedShare = invested ? Math.min(100, (exited / invested) * 100) : null;

  async function remove(e: Exit) {
    if (
      !confirm(
        `${formatDate(e.exitDate)} Exit 기록(원금 ${formatKRW(Number(e.principalAmount))})을 삭제할까요?`,
      )
    )
      return;
    setDeletingId(e.id);
    try {
      const res = await fetch(`/api/positions/${positionId}/exits/${e.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? `삭제 실패 (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exit 이력</CardTitle>
        {!formOpen && (
          <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            Exit 기록
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="투자원금" value={invested === null ? "-" : formatKRWShort(invested)} />
          <Stat
            label="Exit 누적"
            value={exited ? formatKRWShort(exited) : "-"}
            sub={exitedShare !== null && exited ? `원금의 ${exitedShare.toFixed(1)}%` : undefined}
          />
          <Stat
            label="잔여 원금"
            value={remaining === null ? "-" : formatKRWShort(remaining)}
            sub={remaining === 0 ? "전액 Exit" : undefined}
            strong
          />
          <Stat
            label="회수금액"
            value={withProceeds.length ? formatKRWShort(proceeds) : "-"}
            sub={
              realized === null ? undefined : (
                <span className={pnlColor(realized)}>
                  실현손익 {signed(realized, formatKRWShort)}
                  {proceedsBase ? ` (${signed((realized / proceedsBase) * 100, (v) => v.toFixed(1))}%)` : ""}
                </span>
              )
            }
          />
        </div>

        {exitedShare !== null && exited > 0 && (
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
            <div className="h-full bg-[#0A2A5E]" style={{ width: `${exitedShare}%` }} />
          </div>
        )}

        {formOpen && (
          <ExitForm
            positionId={positionId}
            remaining={remaining}
            onDone={() => {
              setFormOpen(false);
              router.refresh();
            }}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {exits.length === 0 ? (
          !formOpen && (
            <p className="text-sm text-gray-400 text-center py-4">
              아직 Exit 기록이 없습니다. 원금 일부를 먼저 회수했다면 &quot;Exit 기록&quot;으로
              남겨 주세요.
            </p>
          )
        ) : (
          <div className="border border-gray-100 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left whitespace-nowrap">일자</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">방식 · 메모</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">Exit 원금</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">회수금액</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">손익</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {exits.map((e) => {
                  const principal = Number(e.principalAmount);
                  const got = e.proceedsAmount === null ? null : Number(e.proceedsAmount);
                  const pnl = got === null ? null : got - principal;
                  return (
                    <tr key={e.id}>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-700">
                        {formatDate(e.exitDate)}
                      </td>
                      <td className="px-3 py-2 text-gray-700 min-w-[120px]">
                        {e.method ?? (e.note ? null : "-")}
                        {e.note && <p className="text-xs text-gray-400">{e.note}</p>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums font-medium text-gray-900">
                        {formatKRW(principal)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-700">
                        {got === null ? "-" : formatKRW(got)}
                      </td>
                      <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", pnlColor(pnl))}>
                        {pnl === null ? (
                          "-"
                        ) : (
                          <>
                            {signed(pnl, formatKRWShort)}
                            <span className="block text-xs">
                              {signed((pnl / principal) * 100, (v) => v.toFixed(1))}%
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => remove(e)}
                          disabled={deletingId === e.id}
                          className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                          aria-label="Exit 기록 삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn("mt-0.5 tabular-nums text-gray-900", strong ? "text-lg font-bold" : "text-base font-semibold")}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-500 tabular-nums mt-0.5">{sub}</p>}
    </div>
  );
}

const INPUT =
  "h-9 w-full px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]";

function ExitForm({
  positionId,
  remaining,
  onDone,
  onCancel,
}: {
  positionId: string;
  remaining: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [exitDate, setExitDate] = useState(todayKst);
  const [principalText, setPrincipalText] = useState("");
  const [proceedsText, setProceedsText] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const principal = parseKrwInput(principalText);
  const proceeds = proceedsText.trim() ? parseKrwInput(proceedsText) : null;
  const principalError =
    principalText.trim() && principal === null
      ? "금액 형식을 확인하세요 (예: 2억, 200,000,000)"
      : principal !== null && principal <= 0
        ? "0보다 커야 합니다"
        : principal !== null && remaining !== null && principal > remaining
          ? `잔여 원금(${formatKRWShort(remaining)})보다 큽니다`
          : null;
  const proceedsError =
    proceedsText.trim() && proceeds === null ? "금액 형식을 확인하세요" : null;
  const canSave =
    !!exitDate && principal !== null && !principalError && !proceedsError && !saving;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || principal === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${positionId}/exits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exitDate,
          principalAmount: principal,
          proceedsAmount: proceeds,
          method: method || null,
          note: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `저장 실패 (HTTP ${res.status})`);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "네트워크 오류");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">Exit 일자</span>
          <input
            type="date"
            value={exitDate}
            onChange={(e) => setExitDate(e.target.value)}
            className={cn(INPUT, "mt-1")}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">방식 (선택)</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(INPUT, "mt-1 bg-white")}>
            <option value="">선택 안 함</option>
            {EXIT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 flex items-center justify-between">
            Exit 원금
            {remaining !== null && remaining > 0 && (
              <button
                type="button"
                onClick={() => setPrincipalText(String(remaining))}
                className="text-[#0A2A5E] hover:underline"
              >
                잔여 전액
              </button>
            )}
          </span>
          <input
            value={principalText}
            onChange={(e) => setPrincipalText(e.target.value)}
            placeholder="예: 2억, 200,000,000"
            inputMode="decimal"
            className={cn(INPUT, "mt-1", principalError && "border-red-400")}
            required
          />
          <span className={cn("text-xs mt-1 block", principalError ? "text-red-600" : "text-gray-400")}>
            {principalError ?? (principal !== null ? `= ${formatKRW(principal)}` : "투자원금(액면) 기준")}
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">회수금액 (선택)</span>
          <input
            value={proceedsText}
            onChange={(e) => setProceedsText(e.target.value)}
            placeholder="실제 받은 금액, 예: 2.4억"
            inputMode="decimal"
            className={cn(INPUT, "mt-1", proceedsError && "border-red-400")}
          />
          <span className={cn("text-xs mt-1 block", proceedsError ? "text-red-600" : "text-gray-400")}>
            {proceedsError ?? (proceeds !== null ? `= ${formatKRW(proceeds)}` : "넣으면 실현손익을 계산합니다")}
          </span>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500">메모 (선택)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 1차 전환 후 장내 매도"
          maxLength={500}
          className={cn(INPUT, "mt-1")}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          취소
        </Button>
        <Button type="submit" size="sm" disabled={!canSave} loading={saving}>
          저장
        </Button>
      </div>
    </form>
  );
}
