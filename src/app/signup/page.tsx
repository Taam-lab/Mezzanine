"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "가입 신청 중 오류가 발생했습니다.");
      return;
    }

    router.push("/signup/pending");
  }

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl text-white text-2xl font-bold mb-4"
            style={{ backgroundColor: "#0A2A5E" }}
          >
            M
          </div>
          <h1 className="text-2xl font-bold text-gray-900">가입 신청</h1>
          <p className="text-gray-500 text-sm mt-1">미래에셋 이메일로만 가입 가능합니다</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="email"
              type="email"
              label="이메일"
              placeholder="name@miraeasset.com"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              hint="@miraeasset.com 도메인만 허용됩니다"
              required
            />
            <Input
              id="name"
              type="text"
              label="이름"
              placeholder="홍길동"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
            />
            <Input
              id="password"
              type="password"
              label="비밀번호"
              placeholder="8자 이상, 영문+숫자 조합"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              hint="8자 이상, 영문과 숫자를 포함해야 합니다"
              required
            />
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" loading={loading} size="lg">
              가입 신청
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              이미 계정이 있으신가요?{" "}
              <Link href="/login" className="text-[#0A2A5E] font-medium hover:underline">
                로그인
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
