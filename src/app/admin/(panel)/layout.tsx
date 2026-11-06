import { AdminLayout } from "@/components/layout/AdminLayout";

/**
 * 관리자 화면 공용 셸. 페이지마다 감싸던 것을 레이아웃으로 올렸다.
 *
 * AdminLayout 은 마운트 시 sessionStorage 의 관리자 비밀번호를 확인하느라 첫 렌더에
 * 전체 화면 스피너를 띄운다. 페이지마다 감싸면 메뉴를 옮길 때마다 그 스피너가 번쩍였다.
 * 레이아웃은 이동 사이에 유지되므로 확인은 진입 시 한 번만 일어난다.
 *
 * /admin (비밀번호 입력 화면) 은 이 그룹 밖에 있어 셸 없이 렌더된다.
 */
export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
