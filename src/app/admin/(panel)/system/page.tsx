"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Save, CheckCircle2, Gauge } from "lucide-react";

interface SystemSettings {
  price_change_threshold: string;
  polling_interval: string;
  allowed_domains: string;
}

interface Diagnostics {
  functionRegion: string | null;
  dbRegion: string | null;
  sameRegion: boolean | null;
  pgbouncer: boolean;
  connectionLimit: string | null;
  queryMs: number;
}

/**
 * 배포 환경 진단 — 화면 속도의 바닥(쿼리 1회 비용)과 그걸 정하는 리전 배치를 보여준다.
 * 판정 기준은 /api/admin/diagnostics 주석 참고.
 */
function DiagnosticsCard({ adminPwd }: { adminPwd: () => string }) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/diagnostics", {
        headers: { "x-admin-password": adminPwd() },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDiag(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const tone =
    diag === null
      ? ""
      : diag.queryMs < 60
        ? "text-green-700"
        : diag.queryMs < 250
          ? "text-yellow-700"
          : "text-red-700";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[#0A2A5E]" />
          속도 진단
        </CardTitle>
        <Button variant="outline" size="sm" onClick={run} loading={running}>
          {diag ? "다시 측정" : "측정"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="text-red-600">측정 실패: {error}</p>}
        {!diag && !error && (
          <p className="text-gray-500">
            서버 함수 리전과 DB 리전, DB 쿼리 1회에 걸리는 시간을 측정합니다. 화면 하나는
            보통 쿼리 1~2회라 이 값이 곧 페이지 전환 지연의 바닥입니다.
          </p>
        )}
        {diag && (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="text-xs text-gray-500">서버 함수 리전 (Vercel)</dt>
                <dd className="font-medium text-gray-900">{diag.functionRegion ?? "알 수 없음"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">DB 리전 (Supabase)</dt>
                <dd className="font-medium text-gray-900">{diag.dbRegion ?? "알 수 없음"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">DB 쿼리 1회</dt>
                <dd className={`font-semibold tabular-nums ${tone}`}>{diag.queryMs}ms</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">연결 방식</dt>
                <dd className="font-medium text-gray-900">
                  {diag.pgbouncer ? "pgbouncer 모드" : "직접"}
                  {diag.connectionLimit ? ` · connection_limit=${diag.connectionLimit}` : ""}
                </dd>
              </div>
            </dl>
            {diag.sameRegion === false && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
                서버 함수와 DB 가 다른 리전에 있습니다. 쿼리마다 대륙 간 왕복이 여러 번
                생깁니다. Vercel 프로젝트 Settings → Functions → Function Region 을 DB 와 같은
                리전(예: DB 가 ap-northeast-2 면 icn1 서울)으로 바꾼 뒤 재배포하세요.
              </p>
            )}
            {diag.sameRegion === true && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">
                서버 함수와 DB 가 같은 리전입니다.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminSystemPage() {
  const [settings, setSettings] = useState<SystemSettings>({
    price_change_threshold: "10",
    polling_interval: "5",
    allowed_domains: "miraeasset.com",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function getAdminPwd() {
    return typeof window !== "undefined" ? sessionStorage.getItem("adminPassword") || "" : "";
  }

  useEffect(() => {
    fetch("/api/admin/system", {
      headers: { "x-admin-password": getAdminPwd() },
    })
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      });
  }, []);

  async function saveSettings() {
    setSaving(true);
    await fetch("/api/admin/system", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": getAdminPwd(),
      },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return <div className="text-center py-12 text-gray-400">불러오는 중...</div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900">시스템 설정</h1>

      <Card>
        <CardHeader>
          <CardTitle>모니터링 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="주가 급등락 임계값 (%)"
            type="number"
            min={1}
            max={50}
            value={settings.price_change_threshold}
            onChange={(e) =>
              setSettings((p) => ({ ...p, price_change_threshold: e.target.value }))
            }
            hint="전일 종가 대비 이 값 이상 변동 시 알림 발송 (기본 10%)"
          />
          <Input
            label="폴링 주기 (분)"
            type="number"
            min={1}
            max={60}
            value={settings.polling_interval}
            onChange={(e) =>
              setSettings((p) => ({ ...p, polling_interval: e.target.value }))
            }
            hint="공시·뉴스·주가 데이터 업데이트 주기 (기본 5분)"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>보안 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="허용 이메일 도메인"
            value={settings.allowed_domains}
            onChange={(e) =>
              setSettings((p) => ({ ...p, allowed_domains: e.target.value }))
            }
            hint="콤마로 구분하여 여러 도메인 입력 가능 (예: miraeasset.com,another.com)"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={saveSettings} loading={saving}>
          {saved ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              저장됨
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              설정 저장
            </>
          )}
        </Button>
      </div>

      <DiagnosticsCard adminPwd={getAdminPwd} />
    </div>
  );
}
