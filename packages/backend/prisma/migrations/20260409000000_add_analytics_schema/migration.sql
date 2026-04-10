-- Sessions: one row per browser session (30-min inactivity timeout)
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT PRIMARY KEY,
  "visitor_id" TEXT NOT NULL,
  "ip_hash" TEXT,
  "user_id" TEXT,
  "device_type" TEXT,
  "browser" TEXT,
  "os" TEXT,
  "country" TEXT,
  "utm_source" TEXT,
  "utm_medium" TEXT,
  "utm_campaign" TEXT,
  "referrer" TEXT,
  "landing_page" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ended_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "is_bounce" BOOLEAN NOT NULL DEFAULT true,
  "event_count" INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "sessions_started_at_idx" ON "sessions"("started_at");
CREATE INDEX IF NOT EXISTS "sessions_visitor_id_idx" ON "sessions"("visitor_id");
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions"("user_id") WHERE "user_id" IS NOT NULL;

-- Events: every tracked action (pageviews + product events)
CREATE TABLE IF NOT EXISTS "events" (
  "id" TEXT PRIMARY KEY,
  "session_id" TEXT REFERENCES "sessions"("id"),
  "user_id" TEXT,
  "type" TEXT NOT NULL,
  "page" TEXT,
  "referrer" TEXT,
  "properties" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "events_session_id_idx" ON "events"("session_id");
CREATE INDEX IF NOT EXISTS "events_type_created_at_idx" ON "events"("type", "created_at");
CREATE INDEX IF NOT EXISTS "events_user_id_idx" ON "events"("user_id") WHERE "user_id" IS NOT NULL;

-- Daily metrics: pre-aggregated rollups, populated by daily cron
CREATE TABLE IF NOT EXISTS "daily_metrics" (
  "date" DATE PRIMARY KEY,
  "visitors" INT NOT NULL DEFAULT 0,
  "unique_ips" INT NOT NULL DEFAULT 0,
  "sessions" INT NOT NULL DEFAULT 0,
  "pageviews" INT NOT NULL DEFAULT 0,
  "signups" INT NOT NULL DEFAULT 0,
  "keys_stored" INT NOT NULL DEFAULT 0,
  "dev_keys_created" INT NOT NULL DEFAULT 0,
  "proxy_calls" INT NOT NULL DEFAULT 0,
  "scans" INT NOT NULL DEFAULT 0,
  "upgrades" INT NOT NULL DEFAULT 0,
  "bounces" INT NOT NULL DEFAULT 0,
  "avg_session_duration_s" FLOAT NOT NULL DEFAULT 0,
  "avg_events_per_session" FLOAT NOT NULL DEFAULT 0
);

-- Weekly cohorts: retention grid (signup week x weeks since signup)
CREATE TABLE IF NOT EXISTS "weekly_cohorts" (
  "cohort_week" DATE NOT NULL,
  "week_number" INT NOT NULL,
  "cohort_size" INT NOT NULL DEFAULT 0,
  "active_count" INT NOT NULL DEFAULT 0,
  PRIMARY KEY ("cohort_week", "week_number")
);

-- RLS: admin-only (service role bypasses; only Worker reads/writes)
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weekly_cohorts" ENABLE ROW LEVEL SECURITY;
