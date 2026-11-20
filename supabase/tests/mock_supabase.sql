-- Minimal stand-in for Supabase's auth schema and roles, so the migration
-- and security tests can run on a plain local Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  email_confirmed_at timestamptz,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;

-- Supabase keeps pgcrypto in "extensions" and offers Vault for encrypted secrets
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null) returns uuid
  language sql as $$ insert into vault.secrets (secret, name) values (new_secret, new_name) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text) returns void
  language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
