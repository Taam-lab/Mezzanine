"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Bell, BellOff, CheckCircle2 } from "lucide-react";

export default function NotificationsSettingsPage() {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPushSupported("Notification" in window && "serviceWorker" in navigator);
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

  async function enablePushNotifications() {
    setLoading(true);
    setMessage("");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("알림 권한이 거부되었습니다.");
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setMessage("VAPID 키가 설정되지 않았습니다. 관리자에게 문의해주세요.");
        return;
      }

      const sw = await navigator.serviceWorker.register("/sw.js");
      const subscription = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setPushEnabled(true);
      setMessage("푸시 알림이 활성화되었습니다.");
    } catch (e) {
      setMessage("알림 설정 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-5">
        <h1 className="text-xl font-bold text-gray-900">알림 설정</h1>

        <Card>
          <CardHeader>
            <CardTitle>웹 푸시 알림</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!pushSupported ? (
              <div className="text-sm text-gray-500">
                이 브라우저는 웹 푸시 알림을 지원하지 않습니다.
              </div>
            ) : pushEnabled ? (
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">푸시 알림 활성화됨</p>
                  <p className="text-xs text-green-600 mt-0.5">긴급·중요 알림 발생 시 브라우저 푸시 알림을 받습니다.</p>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  브라우저 푸시 알림을 활성화하면 긴급 알림을 즉시 받을 수 있습니다.
                </p>
                <Button
                  variant="primary"
                  onClick={enablePushNotifications}
                  loading={loading}
                >
                  <Bell className="h-4 w-4" />
                  푸시 알림 활성화
                </Button>
              </div>
            )}

            {message && (
              <p className={`text-sm ${message.includes("오류") || message.includes("거부") ? "text-red-600" : "text-green-600"}`}>
                {message}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>알림 등급별 설정</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { level: "🔴 긴급 (CRITICAL)", desc: "전환가 조정, 관리종목 지정, 부도 등", enabled: true, locked: true },
                { level: "🟡 중요 (WARNING)", desc: "최대주주 변경, 합병, 소송 등", enabled: true, locked: false },
                { level: "🟢 일반 (INFO)", desc: "정기 공시, 임원 변경 등", enabled: false, locked: false },
              ].map((item) => (
                <div key={item.level} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.level}</p>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.locked && (
                      <span className="text-xs text-gray-400">항상 ON</span>
                    )}
                    <button
                      disabled={item.locked}
                      className={`w-10 h-5 rounded-full transition-colors ${
                        item.enabled ? "bg-[#0A2A5E]" : "bg-gray-200"
                      } ${item.locked ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${
                          item.enabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
