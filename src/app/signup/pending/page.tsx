import Link from "next/link";
import { Clock } from "lucide-react";

export default function PendingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
      <div className="w-full max-w-sm text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10">
          <div className="flex items-center justify-center w-16 h-16 bg-yellow-50 border-2 border-yellow-200 rounded-full mx-auto mb-5">
            <Clock className="h-8 w-8 text-yellow-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-3">관리자 승인 대기 중</h1>
          <p className="text-gray-600 text-sm leading-relaxed mb-6">
            가입 신청이 완료되었습니다.
            <br />
            관리자 승인 후 로그인하실 수 있습니다.
            <br />
            승인은 영업일 기준 1일 이내에 처리됩니다.
          </p>
          <div className="bg-blue-50 rounded-lg px-4 py-3 text-xs text-blue-700 mb-6">
            승인 관련 문의: 투자심사팀 시스템 담당자에게 연락해주세요.
          </div>
          <Link
            href="/login"
            className="text-sm text-[#0A2A5E] font-medium hover:underline"
          >
            로그인 페이지로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
