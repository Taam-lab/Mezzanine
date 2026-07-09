-- 조기상환청구권 회차별 (From, To) 배열을 JSON 문자열로 저장
-- 예: [{"from":"2026-03-03","to":"2026-03-18"},{"from":"2026-06-02","to":"2026-06-17"}, ...]
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "put_option_schedule" TEXT;
