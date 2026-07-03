"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ArrowLeft, Link2, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { positionSchema, type PositionInput } from "@/lib/validations";
import {
  MEZZANINE_TYPE_LABEL,
  INVESTMENT_TYPE_LABEL,
} from "@/lib/utils";

type TabMode = "manual" | "excel" | "disclosure";

interface ParseResult {
  data: Partial<PositionInput>;
  autoFilledFields: string[];
  failedFields: string[];
  _meta?: Record<string, unknown>;
  _rawDecision?: Record<string, unknown>;
}

function NewPositionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabMode>(
    (searchParams.get("mode") as TabMode) || "manual"
  );
  const [dartUrl, setDartUrl] = useState("");
  const [parseLoading, setParseLoading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PositionInput>({
    resolver: zodResolver(positionSchema),
    defaultValues: {
      underlyingMarket: "KOSPI",
      mezzanineType: "CB",
      investmentType: "DIRECT",
    },
  });

  async function handleParseUrl() {
    if (!dartUrl.trim()) return;
    setParseLoading(true);
    setParseError("");
    setParseResult(null);

    try {
      const res = await fetch("/api/parse-disclosure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dartUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        setParseError(data.error || "파싱에 실패했습니다.");
        return;
      }

      if (data._rawDecision) console.log("[DART parse] raw decision:", data._rawDecision);

      if (!data.data || data.autoFilledFields?.length === 0) {
        setParseError("파싱 성공했지만 추출된 필드가 없습니다.");
        return;
      }

      setParseResult(data);
      Object.entries(data.data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          setValue(key as keyof PositionInput, value as never);
        }
      });
    } catch {
      setParseError("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setParseLoading(false);
    }
  }

  async function onSubmit(data: PositionInput) {
    setSaving(true);
    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "저장에 실패했습니다.");
        return;
      }
      router.push(`/positions/${result.id}`);
    } finally {
      setSaving(false);
    }
  }

  const isAutoFilled = (field: string) =>
    parseResult?.autoFilledFields.includes(field) ?? false;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <Link href="/positions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              뒤로
            </Button>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">신규 종목 등록</h1>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {(
            [
              { key: "manual", label: "직접 입력", icon: FileText },
              { key: "disclosure", label: "공시 자동 입력 ⭐", icon: Link2 },
              { key: "excel", label: "엑셀 업로드", icon: Upload },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-white text-[#0A2A5E] shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* 공시 자동 입력 탭 */}
        {tab === "disclosure" && (
          <Card>
            <CardHeader>
              <CardTitle>DART 공시 자동 파싱</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  DART 발행공시 URL을 입력하면 메자닌 발행조건을 자동으로 추출합니다.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={dartUrl}
                    onChange={(e) => setDartUrl(e.target.value)}
                    placeholder="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
                  />
                  <Button
                    variant="primary"
                    onClick={handleParseUrl}
                    loading={parseLoading}
                    disabled={!dartUrl.trim()}
                  >
                    자동 분석
                  </Button>
                </div>
              </div>

              {parseError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {parseError}
                </div>
              )}

              {parseResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    자동 파싱 완료
                  </div>
                  <p className="text-xs text-green-600">
                    {parseResult.autoFilledFields.length}개 항목이 자동으로 채워졌습니다.
                    아래 폼에서 검토 후 저장해주세요.
                  </p>
                  {parseResult.failedFields.length > 0 && (
                    <>
                      <p className="text-xs text-yellow-700 mt-1">
                        미추출 항목 ({parseResult.failedFields.length}개): {parseResult.failedFields.join(", ")}
                      </p>
                      {parseResult.failedFields.some((f: string) => f.startsWith("put") || f.startsWith("call")) && (
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          * 풋옵션/콜옵션 조항은 DART 정형 API에 포함되지 않아 자동 추출이 불가능합니다. 수동 입력해주세요.
                        </p>
                      )}
                    </>
                  )}
                  {(parseResult._rawDecision || parseResult._meta) && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                        DART 정형 API 응답 보기
                      </summary>
                      <div className="mt-2 space-y-2">
                        {parseResult._meta && (
                          <div className="text-xs bg-white p-2 rounded border border-gray-200">
                            <p className="font-medium text-gray-700 mb-1">공시 메타 (list.json):</p>
                            <pre className="text-gray-600 whitespace-pre-wrap break-all font-mono">
                              {JSON.stringify(parseResult._meta, null, 2)}
                            </pre>
                          </div>
                        )}
                        {parseResult._rawDecision && (
                          <div className="text-xs bg-white p-2 rounded border border-gray-200">
                            <p className="font-medium text-gray-700 mb-1">정형 발행결정 데이터 (raw):</p>
                            <pre className="text-gray-600 whitespace-pre-wrap break-all font-mono max-h-96 overflow-y-auto">
                              {JSON.stringify(parseResult._rawDecision, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              )}

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-500">
                  지원 공시: 전환사채권 발행결정, 신주인수권부사채권 발행결정, 교환사채권 발행결정, 증권신고서(채무증권)
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 엑셀 업로드 탭 */}
        {tab === "excel" && (
          <Card>
            <CardHeader>
              <CardTitle>엑셀 일괄 업로드</CardTitle>
            </CardHeader>
            <CardContent className="text-center py-8">
              <Upload className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600 mb-4">
                표준 템플릿을 다운로드하고 작성 후 업로드해주세요.
              </p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" size="sm">
                  템플릿 다운로드
                </Button>
                <Button variant="primary" size="sm">
                  파일 업로드
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-4">Phase 2에서 지원 예정</p>
            </CardContent>
          </Card>
        )}

        {/* 공통: 직접 입력 폼 (manual 탭 또는 자동 파싱 결과 편집) */}
        {(tab === "manual" || tab === "disclosure") && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* 기본 정보 */}
            <Card>
              <CardHeader>
                <CardTitle>기본 정보</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="assetName"
                  label="메자닌 자산명"
                  placeholder="제5회 무보증 사모 전환사채"
                  autoFilled={isAutoFilled("assetName")}
                  error={errors.assetName?.message}
                  {...register("assetName")}
                />
                <Input
                  id="bondCode"
                  label="채권종목번호"
                  placeholder="KR0000000000"
                  hint="DART 공시에서 수동으로 확인해주세요"
                  error={errors.bondCode?.message}
                  {...register("bondCode")}
                />
                <Input
                  id="underlyingTicker"
                  label="기초자산 종목코드"
                  placeholder="000000"
                  maxLength={6}
                  autoFilled={isAutoFilled("underlyingTicker")}
                  error={errors.underlyingTicker?.message}
                  {...register("underlyingTicker")}
                />
                <Input
                  id="underlyingCompanyName"
                  label="기초자산 회사명"
                  placeholder="(주)ABC"
                  autoFilled={isAutoFilled("underlyingCompanyName")}
                  error={errors.underlyingCompanyName?.message}
                  {...register("underlyingCompanyName")}
                />
                <Select
                  id="underlyingMarket"
                  label="상장 시장"
                  options={[
                    { value: "KOSPI", label: "KOSPI" },
                    { value: "KOSDAQ", label: "KOSDAQ" },
                  ]}
                  {...register("underlyingMarket")}
                />
                <Select
                  id="mezzanineType"
                  label="메자닌 형태"
                  options={Object.entries(MEZZANINE_TYPE_LABEL).map(([v, l]) => ({
                    value: v,
                    label: l,
                  }))}
                  {...register("mezzanineType")}
                />
                <Select
                  id="investmentType"
                  label="직접/간접 투자"
                  hint="직접 입력 필수 항목"
                  options={Object.entries(INVESTMENT_TYPE_LABEL).map(([v, l]) => ({
                    value: v,
                    label: l,
                  }))}
                  {...register("investmentType")}
                />
                <Input
                  id="investmentAmount"
                  type="number"
                  label="투자금액 (원)"
                  placeholder="10000000000"
                  hint="직접 입력 필수 항목"
                  error={errors.investmentAmount?.message}
                  {...register("investmentAmount", { valueAsNumber: true })}
                />
                <Input
                  id="issueAmount"
                  type="number"
                  label="발행총액 (원)"
                  placeholder="25000000000"
                  autoFilled={isAutoFilled("issueAmount")}
                  error={errors.issueAmount?.message}
                  {...register("issueAmount", { valueAsNumber: true })}
                />
              </CardContent>
            </Card>

            {/* 발행 조건 */}
            <Card>
              <CardHeader>
                <CardTitle>발행 조건</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="issueDate"
                  type="date"
                  label="발행일 (납입일)"
                  autoFilled={isAutoFilled("issueDate")}
                  {...register("issueDate")}
                />
                <Input
                  id="maturityDate"
                  type="date"
                  label="만기일"
                  autoFilled={isAutoFilled("maturityDate")}
                  {...register("maturityDate")}
                />
                <Input
                  id="couponRate"
                  type="number"
                  step="0.001"
                  label="표면금리 (%)"
                  placeholder="0.00"
                  autoFilled={isAutoFilled("couponRate")}
                  error={errors.couponRate?.message}
                  {...register("couponRate", { valueAsNumber: true })}
                />
                <Input
                  id="ytm"
                  type="number"
                  step="0.001"
                  label="만기이자율 / YTM (%)"
                  placeholder="0.00"
                  autoFilled={isAutoFilled("ytm")}
                  error={errors.ytm?.message}
                  {...register("ytm", { valueAsNumber: true })}
                />
                <Input
                  id="seriesNumber"
                  type="number"
                  label="회차"
                  placeholder="5"
                  hint="전환가 조정 자동 매칭에 사용됩니다"
                  error={errors.seriesNumber?.message}
                  {...register("seriesNumber", { valueAsNumber: true })}
                />
              </CardContent>
            </Card>

            {/* 전환 조건 */}
            <Card>
              <CardHeader>
                <CardTitle>전환 조건</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="initialConversionPrice"
                  type="number"
                  step="0.01"
                  label="최초 전환가 (원)"
                  placeholder="10000"
                  autoFilled={isAutoFilled("initialConversionPrice")}
                  error={errors.initialConversionPrice?.message}
                  {...register("initialConversionPrice", { valueAsNumber: true })}
                />
                <Input
                  id="minConversionPrice"
                  type="number"
                  step="0.01"
                  label="최저 전환가 / 리픽싱 한도 (원)"
                  placeholder="7000"
                  autoFilled={isAutoFilled("minConversionPrice")}
                  error={errors.minConversionPrice?.message}
                  {...register("minConversionPrice", { valueAsNumber: true })}
                />
                <Input
                  id="currentConversionPrice"
                  type="number"
                  step="0.01"
                  label="현재 전환가 (원)"
                  placeholder="최초 전환가와 동일하면 비워두세요"
                  hint="비워두면 최초 전환가로 설정됩니다"
                  autoFilled={isAutoFilled("currentConversionPrice")}
                  {...register("currentConversionPrice", { valueAsNumber: true })}
                />
                <Input
                  id="conversionStartDate"
                  type="date"
                  label="전환 가능 시작일"
                  autoFilled={isAutoFilled("conversionStartDate")}
                  {...register("conversionStartDate")}
                />
                <Input
                  id="conversionEndDate"
                  type="date"
                  label="전환 가능 종료일"
                  autoFilled={isAutoFilled("conversionEndDate")}
                  {...register("conversionEndDate")}
                />
              </CardContent>
            </Card>

            {/* 옵션 조건 */}
            <Card>
              <CardHeader>
                <CardTitle>풋옵션 / 콜옵션 조건</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="putOptionRate"
                  type="number"
                  step="0.001"
                  label="풋옵션 금리 (%)"
                  placeholder="0.00"
                  autoFilled={isAutoFilled("putOptionRate")}
                  {...register("putOptionRate", { valueAsNumber: true })}
                />
                <Input
                  id="putOptionStartDate"
                  type="date"
                  label="풋옵션 행사 시작일"
                  {...register("putOptionStartDate")}
                />
                <Input
                  id="putOptionEndDate"
                  type="date"
                  label="풋옵션 행사 종료일"
                  {...register("putOptionEndDate")}
                />
                <Input
                  id="callOptionRatio"
                  type="number"
                  step="0.01"
                  label="콜옵션 비율 (%)"
                  placeholder="0.00"
                  autoFilled={isAutoFilled("callOptionRatio")}
                  {...register("callOptionRatio", { valueAsNumber: true })}
                />
                <Input
                  id="callOptionRate"
                  type="number"
                  step="0.001"
                  label="콜옵션 금리 (%)"
                  placeholder="0.00"
                  {...register("callOptionRate", { valueAsNumber: true })}
                />
                <Input
                  id="callOptionStartDate"
                  type="date"
                  label="콜옵션 행사 시작일"
                  {...register("callOptionStartDate")}
                />
                <Input
                  id="callOptionEndDate"
                  type="date"
                  label="콜옵션 행사 종료일"
                  {...register("callOptionEndDate")}
                />
              </CardContent>
            </Card>

            {/* 기타 */}
            <Card>
              <CardHeader>
                <CardTitle>기타</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  id="sourceDisclosureUrl"
                  label="공시 URL"
                  placeholder="https://dart.fss.or.kr/..."
                  error={errors.sourceDisclosureUrl?.message}
                  {...register("sourceDisclosureUrl")}
                />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">비고</label>
                  <textarea
                    rows={3}
                    placeholder="기타 특이사항 등"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E] resize-none"
                    {...register("note")}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3 pb-6">
              <Link href="/positions">
                <Button variant="outline">취소</Button>
              </Link>
              <Button type="submit" variant="primary" loading={saving}>
                종목 저장
              </Button>
            </div>
          </form>
        )}
      </div>
    </AppLayout>
  );
}

export default function NewPositionPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin h-8 w-8 border-4 border-[#0A2A5E] border-t-transparent rounded-full" /></div>}>
      <NewPositionContent />
    </Suspense>
  );
}
