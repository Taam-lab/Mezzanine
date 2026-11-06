import { Shimmer } from "@/components/ui/Skeleton";

/** 알림함 스켈레톤 — AlertsClient 의 제목/필터/목록 배치와 맞춘다. */
export default function AlertsLoading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Shimmer className="h-6 w-20" />
        <Shimmer className="h-8 w-24" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-8 w-14 rounded-lg" />
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50 overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="px-5 py-4 flex items-start gap-4">
            <Shimmer className="w-2 h-2 rounded-full mt-2" />
            <div className="flex-1">
              <div className="flex gap-2">
                <Shimmer className="h-5 w-10" />
                <Shimmer className="h-5 w-12" />
              </div>
              <Shimmer className="mt-2 h-4 w-full max-w-md" />
              <Shimmer className="mt-2 h-3 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
