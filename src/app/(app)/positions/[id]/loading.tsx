import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Shimmer } from "@/components/ui/Skeleton";

/**
 * 종목 상세 스켈레톤. 이게 없으면 가장 가까운 경계인 positions/loading.tsx
 * (목록 표 모양)가 상세로 가는 동안 뜬다.
 *
 * 레이아웃은 PositionDetailClient 와 맞춘다 (max-w-5xl, 시세 타일 4개, 2:1 그리드).
 */
export default function PositionDetailLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Shimmer className="h-8 w-16" />
          <div>
            <Shimmer className="h-6 w-40" />
            <Shimmer className="mt-2 h-4 w-56" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Shimmer className="h-8 w-16" />
          <Shimmer className="h-8 w-16" />
        </div>
      </div>

      {/* 시세 타일 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="py-3">
              <Shimmer className="h-3 w-14" />
              <Shimmer className="mt-2 h-7 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <Shimmer className="h-4 w-20" />
            </CardHeader>
            <CardContent>
              <Shimmer className="h-[200px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Shimmer className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i}>
                    <Shimmer className="h-3 w-16" />
                    <Shimmer className="mt-1.5 h-4 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Shimmer className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 8 }, (_, i) => (
                <Shimmer key={i} className="h-4 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
