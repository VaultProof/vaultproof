-- VaultProof employee support notes for the internal admin console.
--
-- Goal:
-- Prepare a service-role-only notes table that the read-only org detail page can
-- display now and future approval-gated admin actions can write to later.

CREATE TABLE IF NOT EXISTS public.internal_admin_support_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  note_type text NOT NULL DEFAULT 'support_note',
  body text NOT NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_admin_support_notes_org_created_idx
  ON public.internal_admin_support_notes (organization_id, created_at DESC);

ALTER TABLE public.internal_admin_support_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_admin_support_notes_no_customer_access
  ON public.internal_admin_support_notes;
CREATE POLICY internal_admin_support_notes_no_customer_access
  ON public.internal_admin_support_notes
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.internal_admin_support_notes FROM anon;
REVOKE ALL ON TABLE public.internal_admin_support_notes FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_admin_support_notes TO service_role;
