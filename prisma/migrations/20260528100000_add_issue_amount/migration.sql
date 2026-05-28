-- Add issue_amount (발행총액) column to positions
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "issue_amount" BIGINT;
