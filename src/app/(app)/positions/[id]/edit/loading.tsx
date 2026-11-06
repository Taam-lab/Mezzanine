import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Shimmer } from "@/components/ui/Skeleton";

/** 종목 수정 폼 스켈레톤 — EditPositionClient 의 max-w-4xl 카드 배치와 맞춘다. */
export default function EditPositionLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Shimmer className="h-8 w-16" />
        <Shimmer className="h-6 w-28" />
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Shimmer className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((j) => (
                <div key={j}>
                  <Shimmer className="h-3 w-20" />
                  <Shimmer className="mt-2 h-9 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
