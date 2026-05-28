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
import { MEZZANINE_TYPE_LABEL, INVESTMENT_TYPE_LABEL, formatDate } from "@/lib/utils";

export default function EditPositionPage() {
  const params = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
          ...data,
          issueDate: data.issueDate ? data.issueDate.split("T")[0] : "",
          maturityDate: data.maturityDate ? data.maturityDate.split("T")[0] : "",
          conversionStartDate: data.conversionStartDate ? data.conversionStartDate.split("T")[0] : "",
          conversionEndDate: data.conversionEndDate ? data.conversionEndDate.split("T")[0] : "",
          putOptionStartDate: data.putOptionStartDate ? data.putOptionStartDate.split("T")[0] : "",
          putOptionEndDate: data.putOptionEndDate ? data.putOptionEndDate.split("T")[0] : "",
          callOptionStartDate: data.callOptionStartDate ? data.callOptionStartDate.split("T")[0] : "",
          callOptionEndDate: data.callOptionEndDate ? data.callOptionEndDate.split("T")[0] : "",
          investmentAmount: data.investmentAmount ? Number(data.investmentAmount) : undefined,
          issueAmount: data.issueAmount ? Number(data.issueAmount) : undefined,
        });
        setLoading(false);
      });
  }, [params.id, reset]);

  async function onSubmit(data: PositionInput) {
    setSaving(true);
    const res = await fetch(`/api/positions/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (res.ok) {
      router.push(`/positions/${params.id}`);
    }
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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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

          <div className="flex justify-end gap-3 pb-6">
            <Link href={`/positions/${params.id}`}><Button variant="outline">취소</Button></Link>
            <Button type="submit" variant="primary" loading={saving}>저장</Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
