"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // 페이지 이동 시 모바일 사이드바 자동 닫힘
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <Header onMenuToggle={() => setMobileOpen((v) => !v)} />
      <main className="md:ml-60 pt-14">
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
