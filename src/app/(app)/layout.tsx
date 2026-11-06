import { AppLayout } from "@/components/layout/AppLayout";

/**
 * 사이드바·헤더 셸을 라우트 그룹 레이아웃에 한 번만 둔다.
 *
 * 이전에는 페이지마다 <AppLayout> 을 직접 감싸고 있어서, 메뉴를 누를 때마다
 * 셸 전체가 언마운트 → 재마운트됐다 (헤더의 알림 뱃지 fetch 도 매번 다시 나갔다).
 * Next 의 레이아웃은 같은 그룹 안의 이동에서 유지되므로, 이제 본문만 바뀐다.
 * 각 페이지의 loading.tsx 스켈레톤도 이 셸 안쪽(본문 자리)에서만 교체된다.
 *
 * (app) 은 URL 에 나타나지 않는다 — /dashboard, /positions 등 경로는 그대로.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
