"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-[#0A2A5E] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <Sidebar />
      <Header />
      <main className="ml-60 pt-14">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
