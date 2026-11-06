/** loading.tsx 스켈레톤용 회색 막대. */
export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}
