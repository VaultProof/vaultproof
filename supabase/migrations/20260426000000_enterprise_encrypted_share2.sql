-- Enterprise executor support: store the second Shamir share encrypted at rest.
-- The legacy B2C path may still use share2_b64; Azure enterprise reads
-- share2_encrypted so no share is stored as plaintext base64.

alter table public.project_keys
  add column if not exists share2_encrypted text;

grant select, insert, update, delete on public.project_keys to service_role;

notify pgrst, 'reload schema';
