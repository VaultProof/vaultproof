-- Allow service-role access log inserts to execute the rollup trigger helpers.
-- The previous rollup migration granted the dashboard RPC, but the trigger calls
-- project_access_log_status_bucket() during INSERT and service_role also needs
-- explicit EXECUTE on the trigger function after PUBLIC is revoked.

GRANT EXECUTE ON FUNCTION public.project_access_log_status_bucket(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollup_project_access_log_insert() TO service_role;

NOTIFY pgrst, 'reload schema';
