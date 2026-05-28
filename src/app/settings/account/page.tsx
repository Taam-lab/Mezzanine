"use client";

import { useSession } from "next-auth/react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { User } from "lucide-react";

export default function AccountSettingsPage() {
  const { data: session } = useSession();

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-5">
        <h1 className="text-xl font-bold text-gray-900">계정 설정</h1>

        <Card>
          <CardHeader>
            <CardTitle>내 계정 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
              <div className="w-12 h-12 rounded-full bg-[#0A2A5E] flex items-center justify-center">
                <User className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="font-medium text-gray-900">{session?.user?.name}</p>
                <p className="text-sm text-gray-500">{session?.user?.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-1">소속</p>
                <p className="font-medium text-gray-900">미래에셋 투자심사팀</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">계정 상태</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  활성
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
