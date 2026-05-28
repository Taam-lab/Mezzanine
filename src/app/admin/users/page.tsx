"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import { CheckCircle2, XCircle, UserX, UserCheck, Clock } from "lucide-react";

interface UserRecord {
  id: string;
  email: string;
  name: string;
  isApproved: boolean;
  isActive: boolean;
  approvedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "approved">("pending");

  function getAdminPwd() {
    return typeof window !== "undefined" ? sessionStorage.getItem("adminPassword") || "" : "";
  }

  async function loadUsers() {
    const res = await fetch("/api/admin/users", {
      headers: { "x-admin-password": getAdminPwd() },
    });
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data);
    setLoading(false);
  }

  async function handleAction(userId: string, action: string) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": getAdminPwd(),
      },
      body: JSON.stringify({ userId, action }),
    });
    await loadUsers();
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const pending = users.filter((u) => !u.isApproved && u.isActive);
  const approved = users.filter((u) => u.isApproved);

  const displayList = tab === "pending" ? pending : approved;

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">사용자 관리</h1>
          <button
            onClick={loadUsers}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            새로고침
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("pending")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "pending"
                ? "bg-[#0A2A5E] text-white"
                : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            <Clock className="h-4 w-4" />
            승인 대기
            {pending.length > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("approved")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "approved"
                ? "bg-[#0A2A5E] text-white"
                : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            승인된 사용자 ({approved.length})
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">불러오는 중...</div>
        ) : displayList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 text-center py-12">
            <p className="text-gray-500 text-sm">
              {tab === "pending" ? "대기 중인 가입 신청이 없습니다." : "승인된 사용자가 없습니다."}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">이름</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">이메일</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">상태</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">
                    {tab === "pending" ? "신청일" : "마지막 로그인"}
                  </th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayList.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 font-medium text-gray-900">{user.name}</td>
                    <td className="px-5 py-3 text-gray-600">{user.email}</td>
                    <td className="px-5 py-3">
                      {user.isApproved ? (
                        <Badge variant="info">승인됨</Badge>
                      ) : user.isActive ? (
                        <Badge variant="warning">대기중</Badge>
                      ) : (
                        <Badge variant="critical">거절됨</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {tab === "pending"
                        ? formatDateTime(user.createdAt)
                        : user.lastLoginAt
                        ? formatDateTime(user.lastLoginAt)
                        : "로그인 없음"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-2">
                        {tab === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => handleAction(user.id, "approve")}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              승인
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => handleAction(user.id, "reject")}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              거절
                            </Button>
                          </>
                        ) : (
                          <>
                            {user.isActive ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAction(user.id, "deactivate")}
                              >
                                <UserX className="h-3.5 w-3.5" />
                                비활성화
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAction(user.id, "activate")}
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                활성화
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
