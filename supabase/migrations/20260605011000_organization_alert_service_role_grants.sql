-- Alert tables are read and written through the enterprise service-role API.
-- Keep the grants explicit so dashboard alert reads, test sends, dispatch runs,
-- and demo seeding work after the tables are created by earlier migrations.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_alert_destinations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_alert_deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_alert_dispatch_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_alert_policies TO service_role;

GRANT SELECT ON public.organization_alert_destinations TO authenticated;
GRANT SELECT ON public.organization_alert_deliveries TO authenticated;
GRANT SELECT ON public.organization_alert_dispatch_runs TO authenticated;
GRANT SELECT ON public.organization_alert_policies TO authenticated;

NOTIFY pgrst, 'reload schema';
