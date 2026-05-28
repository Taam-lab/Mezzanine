"use client";

import { useSession, signOut } from "next-auth/react";
import { Bell, ChevronDown, LogOut, User } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";

export function Header() {
  const { data: session } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/alerts?unreadOnly=true&countOnly=true")
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.count || 0))
      .catch(() => {});
  }, []);

  return (
    <header className="fixed top-0 left-60 right-0 h-14 bg-white border-b border-gray-200 flex items-center px-6 gap-4 z-20">
      {/* 검색 */}
      <div className="flex-1 max-w-md">
        <input
          type="text"
          placeholder="종목명, 종목코드 검색..."
          className="w-full px-4 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]"
        />
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* 알림 벨 */}
        <Link href="/alerts" className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <Bell className="h-5 w-5 text-gray-600" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center px-0.5 font-bold">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        {/* 사용자 메뉴 */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-[#0A2A5E] flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700">{session?.user?.name || "사용자"}</span>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900">{session?.user?.name}</p>
                  <p className="text-xs text-gray-500 truncate">{session?.user?.email}</p>
                </div>
                <Link
                  href="/settings/account"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <User className="h-4 w-4" />
                  계정 설정
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
