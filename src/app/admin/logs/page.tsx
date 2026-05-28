"use client";

import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Activity } from "lucide-react";

export default function AdminLogsPage() {
  return (
    <AdminLayout>
      <div className="space-y-5 max-w-4xl">
        <h1 className="text-xl font-bold text-gray-900">시스템 로그</h1>

        <Card>
          <CardHeader>
            <CardTitle>폴링 작업 이력</CardTitle>
          </CardHeader>
          <CardContent className="text-center py-12">
            <Activity className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              Python 워커와 연동 후 로그가 표시됩니다.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              `/worker/logs` API를 통해 로그를 조회합니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
