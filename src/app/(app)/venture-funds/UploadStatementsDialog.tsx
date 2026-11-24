"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  parseVentureFundStatement,
  sumMarketValue,
  type ParsedStatement,
  type SheetInput,
} from "@/lib/ventureFundParse";
import type { VfFundItem } from "@/lib/ventureFundsQuery";

interface Item {
  key: string;
  fileName: string;
  st: ParsedStatement;
  fundName: string;
  manager: string;
  include: boolean;
}

const nf = new Intl.NumberFormat("ko-KR");
const won = (n: number | null) => (n === null ? "-" : nf.format(n));
const fmtDate = (iso: string) => iso.replace(/-/g, ".");

/**
 * 지난달에 올린 같은 펀드를 찾아 펀드명을 미리 채운다.
 * 펀드코드가 같고 운용사가 충돌하지 않는 펀드가 하나뿐이면 그 펀드 — 펀드명을 고쳐 둔
 * 경우에도 이어지게. 아니면 같은 이름의 펀드, 그것도 없으면 명세부/파일명에서 읽은 이름.
 */
function suggestFund(st: ParsedStatement, funds: VfFundItem[]): { name: string; manager: string } {
  if (st.fundCode) {
    const byCode = funds.filter(
      (f) =>
        f.fundCode === st.fundCode && (!f.manager || !st.manager || f.manager === st.manager),
    );
    if (byCode.length === 1) {
      return { name: byCode[0].name, manager: byCode[0].manager ?? st.manager ?? "" };
    }
  }
  const byName = st.fundName ? funds.find((f) => f.name === st.fundName) : undefined;
  if (byName) return { name: byName.name, manager: byName.manager ?? st.manager ?? "" };
  return { name: st.fundName ?? "", manager: st.manager ?? "" };
}

export default function UploadStatementsDialog({
  funds,
  onClose,
  onSaved,
}: {
  funds: VfFundItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setParsing(true);
    const newItems: Item[] = [];
    const newErrors: string[] = [];
    try {
      // 엑셀 리더(SheetJS)는 업로드할 때만 받는다 — 페이지 첫 로드 번들에 넣지 않는다.
      // .xlsx 와 구버전 .xls(비엔비 명세부) 둘 다 읽는다.
      const XLSX = await import("xlsx");
      for (const file of files) {
        if (!/\.xlsx?$/i.test(file.name)) {
          newErrors.push(`${file.name}: 엑셀 파일(.xlsx, .xls)만 읽을 수 있습니다.`);
          continue;
        }
        try {
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          // raw: 날짜 셀은 일련번호 그대로 받는다 (Date 로 받으면 KST 에서 하루 밀림 —
          // 변환은 파서의 toIsoDate 가 UTC 로 한다).
          const sheets: SheetInput[] = wb.SheetNames.map((name) => ({
            sheet: name,
            data: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
              header: 1,
              raw: true,
              defval: null,
              blankrows: true,
            }),
          }));
          const res = parseVentureFundStatement(file.name, sheets);
          for (const e of res.errors) newErrors.push(`${file.name}: ${e}`);
          res.statements.forEach((st, i) => {
            const s = suggestFund(st, funds);
            newItems.push({
              key: `${file.name}#${st.sheetName}#${st.fundCode ?? i}#${Date.now()}`,
              fileName: file.name,
              st,
              fundName: s.name,
              manager: s.manager,
              include: true,
            });
          });
        } catch (e) {
          newErrors.push(
            `${file.name}: 파일을 읽지 못했습니다 (${e instanceof Error ? e.message : String(e)})`,
          );
        }
      }
    } catch (e) {
      newErrors.push(`엑셀 리더를 불러오지 못했습니다: ${e instanceof Error ? e.message : e}`);
    } finally {
      setItems((prev) => [...prev, ...newItems]);
      setErrors((prev) => [...prev, ...newErrors]);
      setParsing(false);
    }
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const included = items.filter((it) => it.include);
  // 펀드마다 한 장만 저장되므로 같은 펀드명이 두 번 선택되면 막는다.
  const dupNames = (() => {
    const seen = new Map<string, number>();
    for (const it of included) {
      const k = it.fundName.trim();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  })();
  const existingOf = (name: string) => funds.find((f) => f.name === name);
  // 저장된 것보다 오래된 명세부는 서버가 거절한다 — 미리 표시.
  const isOlder = (it: Item) => {
    const ex = existingOf(it.fundName.trim());
    return !!ex && ex.baseDate > it.st.baseDate;
  };
  const blocked = included.some((it) => !it.fundName.trim() || isOlder(it));
  const canSave = included.length > 0 && !blocked && dupNames.size === 0 && !saving;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/venture-funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statements: included.map((it) => ({
            fundName: it.fundName.trim(),
            manager: it.manager.trim() || null,
            fundCode: it.st.fundCode,
            baseDate: it.st.baseDate,
            nav: it.st.nav,
            navPerUnit: it.st.navPerUnit,
            sourceFormat: it.st.format,
            sourceFileName: it.fileName,
            holdings: it.st.holdings,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? `저장 실패 (HTTP ${res.status})`);
        return;
      }
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "네트워크 오류");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/40 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vf-upload-title"
    >
      <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 id="vf-upload-title" className="text-base font-semibold text-gray-900">
            신탁재산명세부 업로드
          </h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 px-4 py-8 border-2 border-dashed rounded-xl cursor-pointer text-center transition-colors",
              dragOver ? "border-[#0A2A5E] bg-blue-50" : "border-gray-200 hover:bg-gray-50",
            )}
          >
            <FileSpreadsheet className="h-7 w-7 text-gray-400" />
            <span className="text-sm text-gray-700">
              {parsing ? "읽는 중..." : "명세부 엑셀 파일(.xlsx, .xls)을 끌어다 놓거나 눌러서 선택"}
            </span>
            <span className="text-xs text-gray-400">
              여러 파일을 한 번에 올릴 수 있습니다. 펀드마다 최신 명세부 한 장만 남고, 이전
              명세부는 지워집니다.
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-1">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          {items.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <datalist id="vf-fund-names">
                {funds.map((f) => (
                  <option key={f.id} value={f.name} />
                ))}
              </datalist>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500">
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2 text-left whitespace-nowrap">파일</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">기준일</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">펀드명</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">운용사</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">종목</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">평가금액 합계</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">순자산</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((it) => {
                    const name = it.fundName.trim();
                    const existing = existingOf(name);
                    const dup = it.include && dupNames.has(name);
                    return (
                      <tr key={it.key} className={cn(!it.include && "opacity-50")}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={it.include}
                            onChange={(e) => update(it.key, { include: e.target.checked })}
                            aria-label="저장 대상"
                            className="rounded accent-[#0A2A5E]"
                          />
                        </td>
                        <td className="px-3 py-2 max-w-[200px]">
                          <p className="truncate text-gray-700" title={it.fileName}>
                            {it.fileName}
                          </p>
                          <p className="text-xs text-gray-400">
                            {it.st.format === "TWO_LINE" ? "통합명세부" : "보유현황표"} · 시트{" "}
                            {it.st.sheetName}
                          </p>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-700">
                          {it.st.baseDate}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={it.fundName}
                            onChange={(e) => update(it.key, { fundName: e.target.value })}
                            list="vf-fund-names"
                            placeholder="펀드명 입력"
                            aria-label="펀드명"
                            className={cn(
                              "w-48 h-8 px-2 text-sm border rounded focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]",
                              it.include && !name ? "border-red-400" : "border-gray-300",
                            )}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={it.manager}
                            onChange={(e) => update(it.key, { manager: e.target.value })}
                            placeholder="(선택)"
                            aria-label="운용사"
                            className="w-32 h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                          {it.st.holdings.length}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-900 whitespace-nowrap">
                          {won(sumMarketValue(it.st.holdings))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                          {won(it.st.nav)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {dup ? (
                            <span className="text-red-600">같은 펀드 중복</span>
                          ) : !name ? (
                            <span className="text-red-600">펀드명 필요</span>
                          ) : existing && isOlder(it) ? (
                            <span className="text-red-600">
                              더 최근 명세부({fmtDate(existing.baseDate)}) 있음
                            </span>
                          ) : existing ? (
                            <span className="text-amber-600">
                              {existing.baseDate === it.st.baseDate
                                ? "같은 기준일 명세부 교체"
                                : `${fmtDate(existing.baseDate)} 명세부 교체`}
                            </span>
                          ) : (
                            <span className="text-[#0A2A5E] font-medium">새 펀드</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            펀드명이 명세부에 없으면 파일명에서 추정합니다. 저장 전에 확인해 주세요.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              취소
            </Button>
            <Button size="sm" onClick={save} disabled={!canSave} loading={saving}>
              {included.length > 0 ? `${included.length}건 저장` : "저장"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
