"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Save, CheckCircle2 } from "lucide-react";

interface SystemSettings {
  price_change_threshold: string;
  polling_interval: string;
  allowed_domains: string;
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

  if (loading) return <AdminLayout><div className="text-center py-12 text-gray-400">불러오는 중...</div></AdminLayout>;

  return (
    <AdminLayout>
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
      </div>
    </AdminLayout>
  );
}
