-- 부분 Exit 기록 (보유 종목 상세의 "Exit 이력").
-- 투자원금 중 일부를 먼저 회수한 건을 남기고, 잔여 원금 = 투자금액 − Exit 원금 합계로 본다.
--
-- 새 테이블만 만들고 기존 테이블은 건드리지 않는다. IF NOT EXISTS / 제약 존재 검사로
-- 감쌌으므로 Supabase SQL Editor 에 그대로 붙여넣어 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS "position_exits" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "exit_date" DATE NOT NULL,
    "principal_amount" BIGINT NOT NULL,
    "proceeds_amount" BIGINT,
    "method" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_exits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "position_exits_position_id_exit_date_idx"
  ON "position_exits"("position_id", "exit_date");

-- 종목을 지우면 Exit 기록도 함께 지워진다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'position_exits_position_id_fkey'
  ) THEN
    ALTER TABLE "position_exits"
      ADD CONSTRAINT "position_exits_position_id_fkey"
      FOREIGN KEY ("position_id") REFERENCES "positions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
