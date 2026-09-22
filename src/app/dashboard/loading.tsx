import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

/**
 * loading.tsx 는 Next 가 page 주위에 암묵적 <Suspense> 를 걸어주는 자리다.
 *
 * 이게 없으면 page.tsx 가 force-dynamic + await Prisma 라서 HTML 응답 자체가
 * DB 응답까지 통째로 막힌다 — 사용자는 사이드바도 없는 흰 화면을 본다.
 * 여기서 껍데기(사이드바/헤더/스켈레톤)를 즉시 흘려보내고, 데이터가 준비되면
 * 실제 내용으로 교체된다. 데이터가 빨라지는 건 아니지만 첫 픽셀이 즉시 나온다.
 *
 * 스켈레톤의 그리드/간격은 DashboardClient 의 실제 레이아웃과 맞춰야
 * 교체 시점에 화면이 튀지 않는다.
 */
function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <Shimmer className="h-6 w-24" />
            <Shimmer className="mt-2 h-3 w-40" />
          </div>
          <Shimmer className="h-9 w-24" />
        </div>

        {/* 요약 타일 4개 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-4">
                <Shimmer className="h-10 w-10 rounded-xl" />
                <div className="flex-1">
                  <Shimmer className="h-3 w-16" />
                  <Shimmer className="mt-2 h-7 w-10" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 풋옵션 행사 가능 종목 (가로 전체) */}
        <Card className="border-red-100">
          <CardHeader>
            <Shimmer className="h-4 w-48" />
          </CardHeader>
          <CardContent className="py-3">
            <div className="flex flex-wrap gap-2">
              <Shimmer className="h-9 w-64" />
              <Shimmer className="h-9 w-56" />
            </div>
          </CardContent>
        </Card>

        {/* 최근 알림 | 주가 변동 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Shimmer className="h-4 w-28" />
              </CardHeader>
              <div className="divide-y divide-gray-50">
                {[0, 1, 2, 3, 4].map((j) => (
                  <div key={j} className="px-5 py-3 flex items-start gap-3">
                    <Shimmer className="h-5 w-10 flex-shrink-0" />
                    <div className="flex-1">
                      <Shimmer className="h-4 w-full max-w-xs" />
                      <Shimmer className="mt-1.5 h-3 w-28" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* 뉴스 | 공시 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Shimmer className="h-4 w-32" />
              </CardHeader>
              <div className="divide-y divide-gray-50">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="px-5 py-3">
                    <Shimmer className="h-3 w-40" />
                    <Shimmer className="mt-2 h-4 w-full" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
