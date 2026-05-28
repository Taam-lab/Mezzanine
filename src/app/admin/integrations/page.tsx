"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { CheckCircle2, AlertCircle, Eye, EyeOff, Save } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface Integration {
  id: string;
  serviceName: string;
  isEnabled: boolean;
  lastValidatedAt: string | null;
  fields: Record<string, string>;
}

const SERVICE_CONFIG: Record<
  string,
  {
    label: string;
    description: string;
    fields: Array<{ key: string; label: string; placeholder: string; type?: string }>;
    fallbackDesc: string;
  }
> = {
  opendart: {
    label: "OpenDART",
    description: "공시 모니터링 (필수)",
    fields: [{ key: "api_key", label: "API Key", placeholder: "OpenDART API Key" }],
    fallbackDesc: "API 키 미등록 시 공시 모니터링 비활성화",
  },
  naver_search: {
    label: "네이버 검색 API",
    description: "뉴스 모니터링",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "네이버 앱 Client ID" },
      { key: "client_secret", label: "Client Secret", placeholder: "네이버 앱 Client Secret" },
    ],
    fallbackDesc: "미등록 시 네이버 금융 스크래핑만 사용",
  },
  kis: {
    label: "한국투자증권 OpenAPI",
    description: "실시간 주가 데이터 (Phase 2)",
    fields: [
      { key: "app_key", label: "App Key", placeholder: "한국투자증권 App Key" },
      { key: "app_secret", label: "App Secret", placeholder: "한국투자증권 App Secret" },
      { key: "account_no", label: "계좌번호", placeholder: "00000000-00" },
    ],
    fallbackDesc: "미등록 시 pykrx + 네이버 스크래핑 사용",
  },
  telegram: {
    label: "텔레그램 봇",
    description: "텔레그램 알림 (Phase 2)",
    fields: [
      { key: "bot_token", label: "Bot Token", placeholder: "텔레그램 Bot Token" },
      { key: "chat_id", label: "Chat ID", placeholder: "텔레그램 Chat ID" },
    ],
    fallbackDesc: "미등록 시 웹 푸시 알림만 사용",
  },
};

export default function AdminIntegrationsPage() {
  const [integrations, setIntegrations] = useState<Record<string, Integration>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  function getAdminPwd() {
    return typeof window !== "undefined" ? sessionStorage.getItem("adminPassword") || "" : "";
  }

  useEffect(() => {
    fetch("/api/admin/integrations", {
      headers: { "x-admin-password": getAdminPwd() },
    })
      .then((r) => r.json())
      .then((data: Integration[]) => {
        const map: Record<string, Integration> = {};
        data.forEach((d) => (map[d.serviceName] = d));
        setIntegrations(map);

        const initForms: Record<string, Record<string, string>> = {};
        data.forEach((d) => {
          initForms[d.serviceName] = Object.fromEntries(
            Object.keys(d.fields).map((k) => [k, ""])
          );
        });
        setForms(initForms);
      });
  }, []);

  async function saveIntegration(serviceName: string) {
    setSaving((p) => ({ ...p, [serviceName]: true }));
    const config = SERVICE_CONFIG[serviceName];
    const currentForm = forms[serviceName] || {};
    const fields: Record<string, string> = {};
    config.fields.forEach((f) => {
      if (currentForm[f.key]) fields[f.key] = currentForm[f.key];
    });

    await fetch("/api/admin/integrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": getAdminPwd(),
      },
      body: JSON.stringify({ serviceName, fields }),
    });

    setSaving((p) => ({ ...p, [serviceName]: false }));
    setSaved((p) => ({ ...p, [serviceName]: true }));
    setTimeout(() => setSaved((p) => ({ ...p, [serviceName]: false })), 3000);
  }

  function updateForm(serviceName: string, field: string, value: string) {
    setForms((p) => ({
      ...p,
      [serviceName]: { ...(p[serviceName] || {}), [field]: value },
    }));
  }

  return (
    <AdminLayout>
      <div className="space-y-5 max-w-3xl">
        <h1 className="text-xl font-bold text-gray-900">API 키 관리</h1>
        <p className="text-sm text-gray-600">
          API 키를 등록하면 시스템이 자동으로 해당 소스로 전환됩니다. 키는 AES-256으로 암호화하여 저장됩니다.
        </p>

        {Object.entries(SERVICE_CONFIG).map(([serviceName, config]) => {
          const integration = integrations[serviceName];
          const isRegistered = integration?.isEnabled;

          return (
            <Card key={serviceName}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div>
                    <CardTitle>{config.label}</CardTitle>
                    <p className="text-xs text-gray-500 mt-0.5">{config.description}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {isRegistered ? (
                      <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        등록됨
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                        <AlertCircle className="h-4 w-4" />
                        미등록
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  📋 {config.fallbackDesc}
                </div>

                {isRegistered && integration.lastValidatedAt && (
                  <p className="text-xs text-green-600">
                    마지막 검증: {formatDateTime(integration.lastValidatedAt)}
                  </p>
                )}

                <div className="space-y-3">
                  {config.fields.map((field) => (
                    <div key={field.key} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 mb-1 block">
                          {field.label}
                          {isRegistered && integration.fields[field.key] && (
                            <span className="ml-2 text-gray-400 font-normal">
                              현재: {integration.fields[field.key]}
                            </span>
                          )}
                        </label>
                        <input
                          type={showFields[`${serviceName}-${field.key}`] ? "text" : "password"}
                          placeholder={field.placeholder}
                          value={forms[serviceName]?.[field.key] || ""}
                          onChange={(e) => updateForm(serviceName, field.key, e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
                        />
                      </div>
                      <button
                        onClick={() =>
                          setShowFields((p) => ({
                            ...p,
                            [`${serviceName}-${field.key}`]: !p[`${serviceName}-${field.key}`],
                          }))
                        }
                        className="mt-6 p-2 text-gray-400 hover:text-gray-600"
                      >
                        {showFields[`${serviceName}-${field.key}`] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => saveIntegration(serviceName)}
                    loading={saving[serviceName]}
                  >
                    {saved[serviceName] ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        저장됨
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        저장
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AdminLayout>
  );
}
