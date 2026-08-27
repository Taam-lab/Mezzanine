ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "corp_code" TEXT;
CREATE INDEX IF NOT EXISTS "positions_corp_code_idx" ON "positions"("corp_code");
