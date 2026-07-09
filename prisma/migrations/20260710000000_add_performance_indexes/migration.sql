-- Performance indexes for common query patterns
-- All CREATE INDEX IF NOT EXISTS so this is safe to re-run.

-- positions: 목록 필터 (is_active), 종목코드 조회, 정렬(created_at)
CREATE INDEX IF NOT EXISTS "positions_is_active_created_at_idx"
  ON "positions" ("is_active", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "positions_underlying_ticker_is_active_idx"
  ON "positions" ("underlying_ticker", "is_active");

-- price_snapshots: 종목별 최신 스냅샷 조회가 가장 뜨거운 경로
CREATE INDEX IF NOT EXISTS "price_snapshots_position_id_snapshot_at_idx"
  ON "price_snapshots" ("position_id", "snapshot_at" DESC);

-- risk_check_results: 종목별 최신 위험지표
CREATE INDEX IF NOT EXISTS "risk_check_results_position_id_checked_at_idx"
  ON "risk_check_results" ("position_id", "checked_at" DESC);

-- disclosures / news_items: 종목별 최신순
CREATE INDEX IF NOT EXISTS "disclosures_position_id_filed_at_idx"
  ON "disclosures" ("position_id", "filed_at" DESC);
CREATE INDEX IF NOT EXISTS "news_items_position_id_published_at_idx"
  ON "news_items" ("position_id", "published_at" DESC);

-- financial_snapshots: 종목별 최신 회계연도/분기
CREATE INDEX IF NOT EXISTS "financial_snapshots_position_id_year_quarter_idx"
  ON "financial_snapshots" ("position_id", "fiscal_year" DESC, "fiscal_quarter" DESC);

-- alerts: 종목별 최근순 + 전체 최근순 (알림 페이지)
CREATE INDEX IF NOT EXISTS "alerts_position_id_created_at_idx"
  ON "alerts" ("position_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "alerts_created_at_idx"
  ON "alerts" ("created_at" DESC);

-- conversion_price_history: 종목별 이력
CREATE INDEX IF NOT EXISTS "conversion_price_history_position_id_adjusted_at_idx"
  ON "conversion_price_history" ("position_id", "adjusted_at" ASC);
