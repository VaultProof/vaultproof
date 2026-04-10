-- Grant table-level permissions on analytics tables.
--
-- When tables are created via the Supabase management API (apply_migration)
-- or raw SQL instead of the standard Supabase dashboard flow, the automatic
-- grants to service_role / authenticated / anon are NOT applied, which
-- caused "permission denied for table events/sessions" errors from the
-- Worker even though it uses the service role key (RLS bypass alone is
-- not enough — you also need the underlying table GRANT).

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sessions", "events", "daily_metrics", "weekly_cohorts" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sessions", "events", "daily_metrics", "weekly_cohorts" TO authenticated;
GRANT SELECT ON TABLE "sessions", "events", "daily_metrics", "weekly_cohorts" TO anon;
