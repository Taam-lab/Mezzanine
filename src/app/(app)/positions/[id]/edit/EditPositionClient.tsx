"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  NULLABLE_POSITION_FIELDS,
  positionSchema,
  type PositionInput,
} from "@/lib/validations";
import { MEZZANINE_TYPE_LABEL, INVESTMENT_TYPE_LABEL } from "@/lib/utils";
import { useNavigateFresh } from "@/lib/useNavigateFresh";

// Prisma Decimal / BigInt 는 API 응답 시 문자열로 직렬화된다.
// 스키마의 z.number()는 문자열을 거부하므로 reset 전에 number로 변환.
function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toDateStr(v: unknown): string {
  if (!v || typeof v !== "string") return "";
  return v.split("T")[0];
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** 서버가 내려준 종목 행(JSON 직렬화 형태) → 폼 값 */
function toFormValues(data: Record<string, unknown>): Partial<PositionInput> {
  return {
    assetName: toStr(data.assetName),
    bondCode: toStr(data.bondCode),
    underlyingTicker: toStr(data.underlyingTicker),
    underlyingCompanyName: toStr(data.underlyingCompanyName),
    underlyingMarket: (data.underlyingMarket as PositionInput["underlyingMarket"]) ?? "KOSPI",
    mezzanineType: (data.mezzanineType as PositionInput["mezzanineType"]) ?? "CB",
    investmentType: (data.investmentType as PositionInput["investmentType"]) ?? "DIRECT",
    investmentAmount: toNum(data.investmentAmount),
    issueAmount: toNum(data.issueAmount),
    issueDate: toDateStr(data.issueDate),
    maturityDate: toDateStr(data.maturityDate),
    couponRate: toNum(data.couponRate),
    ytm: toNum(data.ytm),
    seriesNumber: toNum(data.seriesNumber),
    initialConversionPrice: toNum(data.initialConversionPrice),
    minConversionPrice: toNum(data.minConversionPrice),
    currentConversionPrice: toNum(data.currentConversionPrice),
    conversionStartDate: toDateStr(data.conversionStartDate),
    conversionEndDate: toDateStr(data.conversionEndDate),
    putOptionRate: toNum(data.putOptionRate),
    putOptionStartDate: toDateStr(data.putOptionStartDate),
    putOptionEndDate: toDateStr(data.putOptionEndDate),
    putOptionSchedule: toStr(data.putOptionSchedule),
    callOptionRatio: toNum(data.callOptionRatio),
    callOptionRate: toNum(data.callOptionRate),
    callOptionStartDate: toDateStr(data.callOptionStartDate),
    callOptionEndDate: toDateStr(data.callOptionEndDate),
    sourceDisclosureUrl: toStr(data.sourceDisclosureUrl),
    note: toStr(data.note),
  };
}

/**
 * 종목 수정 폼. 기존 값은 서버 컴포넌트(page.tsx)가 종목 행 하나만 읽어 내려준다.
 * 예전엔 마운트 후 /api/positions/[id] 로 상세 전체(관계 5개 포함)를 받아와
 * reset() 했다 — 폼에 필요 없는 스냅샷·공시·뉴스까지 읽느라 왕복이 길었다.
 */
export default function EditPositionClient({
  id,
  initial,
}: {
  id: string;
  initial: Record<string, unknown>;
}) {
  const { navigateFresh, navigating } = useNavigateFresh();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const defaults = toFormValues(initial);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PositionInput>({
    resolver: zodResolver(positionSchema),
    defaultValues: defaults,
  });

  async function onSubmit(data: PositionInput) {
    setSaving(true);
    setSaveError(null);
    try {
      // 비운 칸은 null 로 명시해 보낸다. undefined 는 JSON 에서 빠져서 서버가
      // "변경 없음"으로 처리했다 (지운 값이 저장 후에도 남던 버그).
      // 이 폼이 다루는 필드만 대상 — 폼에 없는 컬럼(corpCode 등)은 건드리지 않는다.
      const body: Record<string, unknown> = { ...data };
      for (const key of NULLABLE_POSITION_FIELDS) {
        if (!(key in defaults)) continue;
        if (body[key] === undefined || body[key] === "") body[key] = null;
      }
      const res = await fetch(`/api/positions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // 상세 페이지는 30초 라우터 캐시에 옛 값으로 남아 있을 수 있다 —
        // refresh 로 캐시를 비운 뒤 이동한다 (src/lib/useNavigateFresh.ts).
        navigateFresh(`/positions/${id}`);
        return;
      }
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setSaveError(err.error ?? `저장 실패 (HTTP ${res.status})`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function onInvalid(errs: unknown) {
    const first = Object.entries(errs as Record<string, { message?: string }>)[0];
    setSaveError(
      first ? `입력 오류: ${first[0]} — ${first[1]?.message ?? "invalid"}` : "입력값을 확인해주세요.",
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/positions/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            취소
          </Button>
        </Link>
        <h1 className="text-xl font-bold text-gray-900">종목 수정</h1>
      </div>

      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {saveError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-5">
        <Card>
          <CardHeader><CardTitle>기본 정보</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="메자닌 자산명" error={errors.assetName?.message} {...register("assetName")} />
            <Input label="채권종목번호" {...register("bondCode")} />
            <Input label="기초자산 종목코드" maxLength={6} error={errors.underlyingTicker?.message} {...register("underlyingTicker")} />
            <Input label="기초자산 회사명" error={errors.underlyingCompanyName?.message} {...register("underlyingCompanyName")} />
            <Select
              label="상장 시장"
              options={[{ value: "KOSPI", label: "KOSPI" }, { value: "KOSDAQ", label: "KOSDAQ" }]}
              {...register("underlyingMarket")}
            />
            <Select
              label="메자닌 형태"
              options={Object.entries(MEZZANINE_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))}
              {...register("mezzanineType")}
            />
            <Select
              label="직접/간접 투자"
              options={Object.entries(INVESTMENT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))}
              {...register("investmentType")}
            />
            <Input label="투자금액 (원)" type="number" {...register("investmentAmount", { valueAsNumber: true })} />
            <Input label="발행총액 (원)" type="number" {...register("issueAmount", { valueAsNumber: true })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>발행 조건</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="발행일" type="date" {...register("issueDate")} />
            <Input label="만기일" type="date" {...register("maturityDate")} />
            <Input label="표면금리 (%)" type="number" step="0.001" {...register("couponRate", { valueAsNumber: true })} />
            <Input label="YTM (%)" type="number" step="0.001" {...register("ytm", { valueAsNumber: true })} />
            <Input label="회차" type="number" {...register("seriesNumber", { valueAsNumber: true })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>전환 조건</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="최초 전환가" type="number" step="0.01" {...register("initialConversionPrice", { valueAsNumber: true })} />
            <Input label="최저 전환가" type="number" step="0.01" {...register("minConversionPrice", { valueAsNumber: true })} />
            <Input label="현재 전환가" type="number" step="0.01" {...register("currentConversionPrice", { valueAsNumber: true })} />
            <Input label="전환 가능 시작일" type="date" {...register("conversionStartDate")} />
            <Input label="전환 가능 종료일" type="date" {...register("conversionEndDate")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Put Option (조기상환청구권)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Put 시작일" type="date" {...register("putOptionStartDate")} />
            <Input label="Put 종료일" type="date" {...register("putOptionEndDate")} />
            <Input label="Put 수익률 (%)" type="number" step="0.001" {...register("putOptionRate", { valueAsNumber: true })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Call Option (매도청구권)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Call 시작일" type="date" {...register("callOptionStartDate")} />
            <Input label="Call 종료일" type="date" {...register("callOptionEndDate")} />
            <Input label="Call 비율 (%)" type="number" step="0.001" {...register("callOptionRatio", { valueAsNumber: true })} />
            <Input label="Call 이율 (%)" type="number" step="0.001" {...register("callOptionRate", { valueAsNumber: true })} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pb-6">
          <Link href={`/positions/${id}`}><Button variant="outline">취소</Button></Link>
          <Button type="submit" variant="primary" loading={saving || navigating}>저장</Button>
        </div>
      </form>
    </div>
  );
}
