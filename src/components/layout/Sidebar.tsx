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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// href 는 실제 페이지로 바로 건다. /settings 는 redirect() 만 하는 페이지라, 그쪽으로
// 링크하면 클라이언트 라우터가 리다이렉트를 따라가지 못하고 문서를 통째로 다시
// 받는다(전체 새로고침). 활성 표시는 match 접두어로 한다.
const NAV_ITEMS = [
  { href: "/dashboard", match: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/positions", match: "/positions", icon: Briefcase, label: "보유 종목" },
  { href: "/alerts", match: "/alerts", icon: Bell, label: "알림함" },
  { href: "/settings/notifications", match: "/settings", icon: Settings, label: "설정" },
];

interface Props {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: Props) {
  const pathname = usePathname();

  return (
    <>
      {/* 모바일 백드롭 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 h-full w-60 flex flex-col z-40 transition-transform duration-200 ease-out",
          "md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ backgroundColor: "#0A2A5E" }}
      >
        {/* 로고 + 모바일 닫기 */}
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
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
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden p-1 rounded text-blue-200 hover:text-white hover:bg-white/10"
              aria-label="사이드바 닫기"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-white/15 text-white font-medium"
                    : "text-blue-200 hover:bg-white/10 hover:text-white",
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
    </>
  );
}
