"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, Users, Key, Settings, FileText, LogOut, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin/users", icon: Users, label: "사용자 관리" },
  { href: "/admin/integrations", icon: Key, label: "API 키 관리" },
  { href: "/admin/system", icon: Settings, label: "시스템 설정" },
  { href: "/admin/logs", icon: FileText, label: "시스템 로그" },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [adminPassword, setAdminPassword] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const pwd = sessionStorage.getItem("adminPassword");
    if (!pwd) {
      router.push("/admin");
      return;
    }
    setAdminPassword(pwd);
    setChecking(false);
  }, [router]);

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-[#0A2A5E] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F5F7FA]">
      {/* 관리자 사이드바 */}
      <aside className="fixed left-0 top-0 h-full w-56 flex flex-col z-30" style={{ backgroundColor: "#0A2A5E" }}>
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#FF6B35]" />
            <div>
              <p className="text-white font-bold text-sm">관리자</p>
              <p className="text-blue-300 text-xs">Mezz Watch</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {ADMIN_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-white/15 text-white font-medium"
                    : "text-blue-200 hover:bg-white/10 hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-white/10 space-y-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-blue-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            대시보드로
          </Link>
          <button
            onClick={() => {
              sessionStorage.removeItem("adminPassword");
              router.push("/admin");
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-blue-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" />
            관리자 로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 */}
      <main className="ml-56 flex-1 p-6">
        {children}
      </main>
    </div>
  );
}

export function useAdminPassword(): string {
  return sessionStorage.getItem("adminPassword") || "";
}
