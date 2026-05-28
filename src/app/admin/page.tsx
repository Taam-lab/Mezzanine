"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!res.ok) {
      setError("비밀번호가 올바르지 않습니다.");
      return;
    }

    // 세션에 관리자 비밀번호 저장 (간단히 sessionStorage 사용)
    sessionStorage.setItem("adminPassword", password);
    router.push("/admin/users");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ backgroundColor: "#0A2A5E" }}
          >
            <Shield className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">관리자 페이지</h1>
          <p className="text-gray-500 text-sm mt-1">관리자 비밀번호를 입력해주세요</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="adminPassword"
              type="password"
              label="관리자 비밀번호"
              placeholder="비밀번호 입력"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" loading={loading} size="lg">
              <Lock className="h-4 w-4" />
              관리자 진입
            </Button>
          </form>
        </div>

        <div className="mt-4 text-center">
          <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">
            대시보드로 돌아가기
          </a>
        </div>
      </div>
    </div>
  );
}
