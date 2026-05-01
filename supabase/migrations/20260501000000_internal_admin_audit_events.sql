-- VaultProof employee/internal admin audit stream.
--
-- Goal:
-- Record every internal admin console view and future employee action without
-- exposing the stream to customer dashboard sessions.

CREATE TABLE IF NOT EXISTS public.internal_admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  event_type text NOT NULL,
  target_type text NOT NULL DEFAULT 'internal_admin',
  target_id text,
  request_method text,
  request_path text,
  request_host text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_admin_audit_events_actor_created_idx
  ON public.internal_admin_audit_events (actor_email, created_at DESC);

CREATE INDEX IF NOT EXISTS internal_admin_audit_events_type_created_idx
  ON public.internal_admin_audit_events (event_type, created_at DESC);

ALTER TABLE public.internal_admin_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_admin_audit_events_no_customer_access
  ON public.internal_admin_audit_events;
CREATE POLICY internal_admin_audit_events_no_customer_access
  ON public.internal_admin_audit_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.internal_admin_audit_events FROM anon;
REVOKE ALL ON TABLE public.internal_admin_audit_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_admin_audit_events TO service_role;
