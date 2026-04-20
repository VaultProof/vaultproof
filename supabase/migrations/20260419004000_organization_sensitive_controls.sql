-- Organization-sensitive controls.
--
-- Goal:
-- Add soft archive support for organizations and a transactional ownership
-- transfer primitive so the worker can expose safer destructive/admin flows.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organizations_archived_at_idx
  ON public.organizations (archived_at);

DROP FUNCTION IF EXISTS public.transfer_organization_ownership(uuid, uuid, uuid);

CREATE FUNCTION public.transfer_organization_ownership(
  p_organization_id uuid,
  p_current_owner_user_id uuid,
  p_target_owner_user_id uuid
)
RETURNS TABLE (
  organization_id uuid,
  previous_owner_user_id uuid,
  new_owner_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text;
  v_current_membership_id uuid;
  v_target_membership_id uuid;
BEGIN
  IF p_current_owner_user_id = p_target_owner_user_id THEN
    RAISE EXCEPTION 'Target owner must be different from current owner';
  END IF;

  v_kind := (
    SELECT o.kind
    FROM public.organizations AS o
    WHERE o.id = p_organization_id
      AND o.archived_at IS NULL
    FOR UPDATE
  );

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF v_kind = 'personal' THEN
    RAISE EXCEPTION 'Personal organizations cannot be transferred';
  END IF;

  v_current_membership_id := (
    SELECT om.id
    FROM public.organization_members AS om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = p_current_owner_user_id
      AND om.role = 'owner'
    FOR UPDATE
  );

  IF v_current_membership_id IS NULL THEN
    RAISE EXCEPTION 'Current owner membership not found';
  END IF;

  v_target_membership_id := (
    SELECT om.id
    FROM public.organization_members AS om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = p_target_owner_user_id
    FOR UPDATE
  );

  IF v_target_membership_id IS NULL THEN
    RAISE EXCEPTION 'Target member not found';
  END IF;

  UPDATE public.organization_members
  SET role = 'owner'
  WHERE id = v_target_membership_id;

  UPDATE public.organization_members
  SET role = 'admin'
  WHERE id = v_current_membership_id;

  UPDATE public.organizations
  SET owner_user_id = p_target_owner_user_id,
      updated_at = now()
  WHERE id = p_organization_id;

  RETURN QUERY
  SELECT p_organization_id, p_current_owner_user_id, p_target_owner_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.transfer_organization_ownership(uuid, uuid, uuid) TO service_role;
