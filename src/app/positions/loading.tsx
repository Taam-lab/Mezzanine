import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/Card";

/**
 * page.tsx 가 force-dynamic + await Prisma 이므로 Suspense 경계가 없으면
 * DB 응답까지 흰 화면이 나온다. loading.tsx 가 그 경계 역할을 해서
 * 사이드바/헤더/표 골격을 즉시 흘려보낸다.
 */
function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

export default function PositionsLoading() {
  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Shimmer className="h-6 w-28" />
          <div className="flex items-center gap-2">
            <Shimmer className="h-9 w-24" />
            <Shimmer className="h-9 w-28" />
            <Shimmer className="h-9 w-24" />
          </div>
        </div>

        {/* 검색 */}
        <Shimmer className="h-11 w-full rounded-xl" />

        {/* 표 골격 */}
        <Card>
          <div className="overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 flex gap-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Shimmer key={i} className="h-3 flex-1" />
              ))}
            </div>
            <div className="divide-y divide-gray-50">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-6">
                  {[0, 1, 2, 3, 4, 5].map((j) => (
                    <Shimmer key={j} className="h-4 flex-1" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
