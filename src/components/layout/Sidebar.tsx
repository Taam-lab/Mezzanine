"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Bell,
  Settings,
  Shield,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/positions", icon: Briefcase, label: "보유 종목" },
  { href: "/alerts", icon: Bell, label: "알림함" },
  { href: "/settings", icon: Settings, label: "설정" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-60 flex flex-col z-30" style={{ backgroundColor: "#0A2A5E" }}>
      {/* 로고 */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: "#FF6B35" }}
          >
            M
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Mezz Watch</p>
            <p className="text-blue-300 text-xs">메자닌 모니터링</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
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
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight className="h-3 w-3 opacity-60" />}
            </Link>
          );
        })}
      </nav>

      {/* 관리자 링크 */}
      <div className="px-3 py-4 border-t border-white/10">
        <Link
          href="/admin"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-blue-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Shield className="h-4 w-4" />
          <span>관리자</span>
        </Link>
      </div>
    </aside>
  );
}
