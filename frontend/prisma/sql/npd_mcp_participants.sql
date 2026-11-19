-- npd_mcp_participants: sign-ups to the NPD MCP working group (/npd-mcp).
-- Gene runs this once, as written, in the Supabase SQL editor for project
-- hspqvcoinujtfodreqaf. It is not run by any script, workflow or agent.
-- Keep in sync by hand with `model NpdMcpParticipant` in ../schema.prisma.
--
-- Access model:
--   * The app's own Prisma connection (role `postgres`, the table owner)
--     inserts sign-ups and reads the opted-in, approved organization names
--     for the page. As owner it is not subject to RLS.
--   * `approved` starts false. A row is listed on the page only when both
--     list_publicly and approved are true. The admin alert for a sign-up that
--     asked to be listed carries the update statement that approves it, run
--     by hand in the SQL editor after a check.
--   * anon / authenticated / service_role (PostgREST): no privileges, and
--     RLS has no policy for them, so the REST API returns nothing. Contact
--     name, email, IP and user agent are never readable through it.
--
-- Use this file, not `prisma db push`: db push would create the table with
-- Supabase's default API grants and no RLS, leaving contact details readable
-- through the REST API. If db push ever created the table first, run this
-- file anyway; the RLS and revoke statements below repair it.
--
-- Safe to re-run. Until it has run, the page renders with an empty
-- "Who has joined" list and the sign-up route answers 503.

begin;

create table if not exists public.npd_mcp_participants (
  id            text         not null,
  organization  text         not null,
  contact_name  text         not null,
  email         text         not null,
  org_type      text         not null,
  participation jsonb        not null,
  use_case      text,
  list_publicly boolean      not null default false,
  approved      boolean      not null default false,
  ip_address    text,
  user_agent    text,
  created_at    timestamp(3) not null default current_timestamp,
  constraint npd_mcp_participants_pkey primary key (id)
);

-- Upgrades a table created before `approved` existed.
alter table public.npd_mcp_participants
  add column if not exists approved boolean not null default false;

create index if not exists npd_mcp_participants_list_publicly_created_at_idx
  on public.npd_mcp_participants (list_publicly, created_at);

alter table public.npd_mcp_participants enable row level security;

-- Supabase grants new public tables to the API roles by default. Take it back.
revoke all on table public.npd_mcp_participants from public, anon, authenticated, service_role;

commit;

-- Verification (run after the block above):
--   select relrowsecurity from pg_class where relname = 'npd_mcp_participants';  -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'npd_mcp_participants'
--       and grantee in ('anon', 'authenticated', 'service_role');                  -- no rows
