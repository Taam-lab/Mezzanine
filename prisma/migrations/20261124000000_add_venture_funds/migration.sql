-- 코벤펀드(코스닥벤처펀드) 신탁재산명세부 보관용 테이블 2개.
-- 펀드마다 가장 최근 명세부 한 장만 둔다 (venture_funds 에 기준일·순자산, 보유종목은
-- venture_fund_holdings). 새 명세부를 올리면 그 펀드의 보유종목을 갈아끼운다.
--
-- 새 테이블만 만들고 기존 테이블은 건드리지 않는다. IF NOT EXISTS / 제약 존재 검사로
-- 감쌌으므로 Supabase SQL Editor 에 그대로 붙여넣어 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS "venture_funds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manager" TEXT,
    "fund_code" TEXT,
    "base_date" DATE NOT NULL,
    "nav" BIGINT,
    "nav_per_unit" DOUBLE PRECISION,
    "source_format" TEXT NOT NULL,
    "source_file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venture_funds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "venture_fund_holdings" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "asset_class" TEXT NOT NULL,
    "asset_class_raw" TEXT NOT NULL,
    "category" TEXT,
    "mezz_type" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "quantity" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "acquisition_amount" BIGINT,
    "book_amount" BIGINT,
    "market_value" BIGINT NOT NULL,
    "maturity_date" DATE,

    CONSTRAINT "venture_fund_holdings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "venture_funds_name_key"
  ON "venture_funds"("name");
CREATE INDEX IF NOT EXISTS "venture_fund_holdings_fund_id_seq_idx"
  ON "venture_fund_holdings"("fund_id", "seq");

-- 펀드를 지우면 보유종목도 함께 지워진다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venture_fund_holdings_fund_id_fkey'
  ) THEN
    ALTER TABLE "venture_fund_holdings"
      ADD CONSTRAINT "venture_fund_holdings_fund_id_fkey"
      FOREIGN KEY ("fund_id") REFERENCES "venture_funds"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
