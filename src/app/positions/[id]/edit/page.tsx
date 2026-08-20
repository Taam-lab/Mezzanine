"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { positionSchema, type PositionInput } from "@/lib/validations";
import { MEZZANINE_TYPE_LABEL, INVESTMENT_TYPE_LABEL } from "@/lib/utils";

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

export default function EditPositionPage() {
  const params = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PositionInput>({
    resolver: zodResolver(positionSchema),
  });

  useEffect(() => {
    fetch(`/api/positions/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        reset({
          assetName: toStr(data.assetName),
          bondCode: toStr(data.bondCode),
          underlyingTicker: toStr(data.underlyingTicker),
          underlyingCompanyName: toStr(data.underlyingCompanyName),
          underlyingMarket: data.underlyingMarket ?? "KOSPI",
          mezzanineType: data.mezzanineType ?? "CB",
          investmentType: data.investmentType ?? "DIRECT",
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
        });
        setLoading(false);
      });
  }, [params.id, reset]);

  async function onSubmit(data: PositionInput) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/positions/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        router.push(`/positions/${params.id}`);
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

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-4 border-[#0A2A5E] border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Link href={`/positions/${params.id}`}>
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
            <Link href={`/positions/${params.id}`}><Button variant="outline">취소</Button></Link>
            <Button type="submit" variant="primary" loading={saving}>저장</Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
