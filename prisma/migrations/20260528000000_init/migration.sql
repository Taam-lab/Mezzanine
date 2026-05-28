-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "bond_code" TEXT,
    "asset_name" TEXT NOT NULL,
    "underlying_ticker" TEXT NOT NULL,
    "underlying_company_name" TEXT NOT NULL,
    "underlying_market" TEXT NOT NULL DEFAULT 'KOSPI',
    "mezzanine_type" TEXT NOT NULL DEFAULT 'CB',
    "issue_date" TIMESTAMP(3),
    "investment_type" TEXT NOT NULL DEFAULT 'DIRECT',
    "investment_amount" BIGINT,
    "maturity_date" TIMESTAMP(3),
    "coupon_rate" DOUBLE PRECISION,
    "ytm" DOUBLE PRECISION,
    "initial_conversion_price" DOUBLE PRECISION,
    "min_conversion_price" DOUBLE PRECISION,
    "current_conversion_price" DOUBLE PRECISION,
    "conversion_start_date" TIMESTAMP(3),
    "conversion_end_date" TIMESTAMP(3),
    "put_option_rate" DOUBLE PRECISION,
    "put_option_start_date" TIMESTAMP(3),
    "put_option_end_date" TIMESTAMP(3),
    "call_option_ratio" DOUBLE PRECISION,
    "call_option_start_date" TIMESTAMP(3),
    "call_option_end_date" TIMESTAMP(3),
    "call_option_rate" DOUBLE PRECISION,
    "series_number" INTEGER,
    "source_disclosure_url" TEXT,
    "owner_user_id" TEXT NOT NULL,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_price_history" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "old_price" DOUBLE PRECISION NOT NULL,
    "new_price" DOUBLE PRECISION NOT NULL,
    "adjustment_reason" TEXT,
    "source_disclosure_id" TEXT,
    "adjusted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_automatic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversion_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "position_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "source_url" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_user_status" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "alert_user_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_items" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "source" TEXT,
    "source_url" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "matched_keywords" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disclosures" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "rcept_no" TEXT NOT NULL,
    "corp_code" TEXT,
    "report_name" TEXT NOT NULL,
    "report_type" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "filed_at" TIMESTAMP(3) NOT NULL,
    "dart_url" TEXT,
    "parsed_data" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disclosures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "change_rate" DOUBLE PRECISION,
    "volume" BIGINT,
    "market_cap" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'naver',
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_snapshots" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "fiscal_quarter" INTEGER NOT NULL DEFAULT 0,
    "revenue" BIGINT,
    "operating_profit" BIGINT,
    "net_income" BIGINT,
    "total_equity" BIGINT,
    "capital" BIGINT,
    "audit_opinion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_check_results" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "value" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position_id" TEXT,
    "alert_type" TEXT,
    "severity" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT NOT NULL DEFAULT 'web_push',

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "credentials" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_validated_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "alert_user_status_alert_id_user_id_key" ON "alert_user_status"("alert_id", "user_id");
CREATE UNIQUE INDEX "news_items_source_url_key" ON "news_items"("source_url");
CREATE UNIQUE INDEX "disclosures_rcept_no_key" ON "disclosures"("rcept_no");
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE UNIQUE INDEX "integrations_service_name_key" ON "integrations"("service_name");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversion_price_history" ADD CONSTRAINT "conversion_price_history_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversion_price_history" ADD CONSTRAINT "conversion_price_history_source_disclosure_id_fkey"
    FOREIGN KEY ("source_disclosure_id") REFERENCES "disclosures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "alert_user_status" ADD CONSTRAINT "alert_user_status_alert_id_fkey"
    FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alert_user_status" ADD CONSTRAINT "alert_user_status_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "news_items" ADD CONSTRAINT "news_items_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "risk_check_results" ADD CONSTRAINT "risk_check_results_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
