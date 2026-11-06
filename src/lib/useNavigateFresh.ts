"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * 데이터를 바꾼 직후(저장·등록) 다른 페이지로 이동할 때 쓴다.
 *
 * Next 14 의 클라이언트 라우터는 최근 30초 안에 본 동적 페이지를 서버에 다시 묻지
 * 않고 재사용한다 (experimental.staleTimes.dynamic 기본값). 메뉴를 오가는 이동이
 * 즉시 뜨는 건 이 덕분이지만, 수정 직후 상세로 돌아가면 옛 값이 그대로 보인다.
 *
 * router.refresh() 는 완료되는 시점에 그 캐시를 통째로 비운다. 그래서 refresh 가
 * 끝나기를 기다렸다가 push 한다.
 *  - push 를 먼저 하면 옛 페이지가 잠깐 보였다가 바뀐다.
 *  - refresh 직후 바로 push 하면 Next 가 진행 중인 refresh 를 버려(navigation 우선)
 *    캐시가 비워지지 않는다. (next/dist/shared/lib/router/action-queue.js)
 */
export function useNavigateFresh() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (target && !refreshing && !pushed.current) {
      pushed.current = true;
      router.push(target);
    }
  }, [target, refreshing, router]);

  function navigateFresh(href: string) {
    pushed.current = false;
    setTarget(href);
    startTransition(() => router.refresh());
  }

  return { navigateFresh, navigating: target !== null };
}
