import { Card } from "@/components/ui/Card";
import { Shimmer } from "@/components/ui/Skeleton";

/** 페이지가 DB 를 기다리는 동안 셸과 골격을 먼저 보여준다 (VentureFundsClient 레이아웃과 맞춤). */
export default function VentureFundsLoading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Shimmer className="h-6 w-24" />
          <Shimmer className="mt-2 h-3 w-56" />
        </div>
        <Shimmer className="h-9 w-28" />
      </div>

      <Card>
        <div className="divide-y divide-gray-50">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-6">
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <Shimmer key={j} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Shimmer className="h-3 w-16" />
            <Shimmer className="mt-3 h-6 w-28" />
          </Card>
        ))}
      </div>

      <Card>
        <div className="divide-y divide-gray-50">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-6">
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <Shimmer key={j} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
