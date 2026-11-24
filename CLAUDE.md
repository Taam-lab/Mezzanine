# Mezz Watch (메자닌 모니터링)

Next.js 14 + Prisma(Supabase Postgres) 웹앱은 Vercel, `worker/`(Python)는 Render 에 배포된다.

## 배포

- 운영 브랜치는 `claude/adoring-pascal-FQ4ID` (저장소 기본 브랜치). 여기에 머지되면 Vercel 이
  운영 배포한다. 다른 브랜치에 푸시하면 프리뷰 배포만 생긴다.
- DB 마이그레이션은 자동 적용되지 않는다. 사용자가 `prisma/migrations/*/migration.sql` 을
  Supabase SQL Editor 에 직접 붙여넣는다. 그래서 SQL 은 `IF NOT EXISTS` 등으로 여러 번
  실행해도 안전하게 쓴다.

## 작업을 마치면 (사용자 지시)

묻지 말고 PR 생성부터 머지까지 바로 한다.

1. `npx tsc --noEmit -p .` 와 `next build` 가 통과하는지 확인한다
   (빌드에는 `DATABASE_URL` 에 아무 Postgres URL 이나 넣으면 된다).
2. 작업 브랜치를 푸시하고 `claude/adoring-pascal-FQ4ID` 로 PR 을 만든다.
3. PR 의 Vercel 프리뷰 상태(commit status "Vercel")가 success 인지 확인한다.
4. squash 머지한다. 커밋 제목 끝에 `(#PR번호)`.

예외: 새 마이그레이션 SQL 이 있는 변경은 머지 전에 사용자가 Supabase 에 SQL 을 넣었는지
먼저 확인받는다. 코드가 먼저 배포되면 없는 테이블·컬럼을 읽다가 화면이 깨진다.

## 코벤펀드 명세부

`/venture-funds` 는 운용사마다 양식이 다른 신탁재산명세부(.xlsx/.xls)를 브라우저에서 읽는다.
파서는 `src/lib/ventureFundParse.ts` 이고, 지원하는 양식과 규칙은 파일 상단 주석에 있다.
새 양식이 "양식을 알아보지 못했습니다"로 실패하면 그 파일을 받아 헤더 이름 후보를 늘리고,
지금까지 받은 명세부가 모두 같은 합계로 읽히는지 다시 확인한다.
