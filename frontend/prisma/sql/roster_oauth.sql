-- Roster verification audit log and OAuth 2.1 tables for the MCP server.
-- Run once for project hspqvcoinujtfodreqaf, by Gene or with his go-ahead,
-- BEFORE the code deploys (the routes read these tables). Keep in sync by hand
-- with RosterVerification, OAuthClient, OAuthCode and OAuthToken in
-- ../schema.prisma. Use this file, not `prisma db push`. Safe to re-run.
-- Only the app's own connection (role postgres, the owner) reads or writes
-- them; the REST API roles get nothing.

begin;

create table if not exists public.roster_verifications (
  id            text         not null,
  key_id        text         not null,
  surface       text         not null,
  npi_count     integer      not null,
  flagged_count integer      not null,
  outcome       text         not null,
  created_at    timestamp(3) not null default current_timestamp,
  constraint roster_verifications_pkey primary key (id)
);
create index if not exists roster_verifications_key_id_created_at_idx on public.roster_verifications (key_id, created_at);

create table if not exists public.oauth_clients (
  id            text         not null,
  client_name   text,
  redirect_uris jsonb        not null,
  ip_address    text,
  created_at    timestamp(3) not null default current_timestamp,
  constraint oauth_clients_pkey primary key (id)
);

create table if not exists public.oauth_codes (
  code_hash      text         not null,
  client_id      text         not null,
  api_key_id     text         not null,
  redirect_uri   text         not null,
  code_challenge text         not null,
  expires_at     timestamp(3) not null,
  used_at        timestamp(3),
  created_at     timestamp(3) not null default current_timestamp,
  constraint oauth_codes_pkey primary key (code_hash)
);
create index if not exists oauth_codes_expires_at_idx on public.oauth_codes (expires_at);

create table if not exists public.oauth_tokens (
  token_hash text         not null,
  kind       text         not null,
  client_id  text         not null,
  api_key_id text         not null,
  expires_at timestamp(3) not null,
  revoked_at timestamp(3),
  created_at timestamp(3) not null default current_timestamp,
  constraint oauth_tokens_pkey primary key (token_hash)
);
create index if not exists oauth_tokens_api_key_id_idx on public.oauth_tokens (api_key_id);
create index if not exists oauth_tokens_expires_at_idx on public.oauth_tokens (expires_at);

alter table public.roster_verifications enable row level security;
alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;

revoke all on table public.roster_verifications from public, anon, authenticated, service_role;
revoke all on table public.oauth_clients from public, anon, authenticated, service_role;
revoke all on table public.oauth_codes from public, anon, authenticated, service_role;
revoke all on table public.oauth_tokens from public, anon, authenticated, service_role;

commit;

-- Verification:
--   select relname, relrowsecurity from pg_class
--     where relname in ('roster_verifications','oauth_clients','oauth_codes','oauth_tokens');  -- all true
--   select table_name, grantee from information_schema.role_table_grants
--     where table_name in ('roster_verifications','oauth_clients','oauth_codes','oauth_tokens')
--       and grantee in ('anon','authenticated','service_role');                                  -- no rows
