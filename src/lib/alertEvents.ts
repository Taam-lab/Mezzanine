/**
 * 알림 데이터가 바뀌었음을 헤더(미확인 뱃지)에 알리는 브라우저 이벤트.
 *
 * 헤더는 이제 레이아웃에 상주해서 페이지 이동 때 다시 마운트되지 않는다.
 * 예전처럼 "이동할 때마다 다시 fetch" 에 기대면 뱃지가 갱신되지 않으므로,
 * 알림을 읽음 처리·삭제·생성한 쪽이 이 이벤트를 쏘고 헤더가 그때만 다시 센다.
 */
export const ALERTS_CHANGED_EVENT = "mezz:alerts-changed";

export function notifyAlertsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
}
