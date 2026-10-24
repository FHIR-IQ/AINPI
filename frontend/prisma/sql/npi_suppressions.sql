-- npi_suppressions: the list of individual NPIs removed from ainpi.dev on
-- request (docs/privacy.md). Run once, as written, in the Supabase SQL editor
-- for project hspqvcoinujtfodreqaf. Do NOT use `prisma db push` for this
-- table: it would not enable row-level security or create the roles below.
-- Keep in sync by hand with `model NpiSuppression` in ../schema.prisma.
--
-- Access model:
--   * The app's own Prisma connection (role `postgres`, the table owner)
--     records requests and sends confirmations. As owner it is not subject
--     to RLS, and it is the only role that can read requester_email.
--   * ainpi_suppression_reader  SELECT (npi) only. CI and weekly-refresh.
--   * ainpi_suppression_apply   SELECT (npi, status, requested_at, not_before),
--                               UPDATE (status, applied_at). suppression-apply.yml.
--   * anon / authenticated / service_role (PostgREST): no privileges, and
--     RLS has no policy for them, so the REST API returns nothing.
--   * Both restricted roles see only rows in FULL force: status pending,
--     applied or confirmed; not_before empty or past (a request queued over
--     the daily cap becomes visible on its day); and basis not 'unverified'.
--     An unverified row (NPPES could not say whether the NPI is a person's
--     and it is in none of our files) filters practitioner search results at
--     runtime only, and must never touch organization data in the published
--     files, so the file scrub must not see it. The confirm cron re-checks
--     NPPES daily and moves it to 'nppes' (full force) or 'declined'.
--     Declined requests (organization NPIs) are invisible to both roles.
--
-- Safe to re-run, and safe over the earlier draft of this file (which was
-- never run in production; the upgrade statements below are defensive only).
--
-- Before running: replace both REPLACE_..._PASSWORD values with long random
-- passwords (e.g. `openssl rand -base64 32`), and do not save the edited
-- file. Connection URLs use the session pooler (IPv4, works from GitHub):
--   postgresql://ainpi_suppression_reader.hspqvcoinujtfodreqaf:<pw>@aws-1-us-east-2.pooler.supabase.com:5432/postgres
--   postgresql://ainpi_suppression_apply.hspqvcoinujtfodreqaf:<pw>@aws-1-us-east-2.pooler.supabase.com:5432/postgres

begin;

create table if not exists public.npi_suppressions (
  id                 text         not null,
  npi                text         not null,
  requester_email    text,
  source             text         not null,
  status             text         not null default 'pending',
  basis              text,
  had_page           boolean,
  requested_at       timestamp(3) not null default current_timestamp,
  not_before         timestamp(3),
  applied_at         timestamp(3),
  confirm_checked_at timestamp(3),
  confirm_claimed_at timestamp(3),
  confirmed_at       timestamp(3),
  overdue_alerted_at timestamp(3),
  reclassify_checked_at timestamp(3),
  constraint npi_suppressions_pkey primary key (id),
  constraint npi_suppressions_npi_format check (npi ~ '^[0-9]{10}$'),
  constraint npi_suppressions_source_check check (source in ('form', 'email', 'manual')),
  constraint npi_suppressions_status_check check (status in ('pending', 'applied', 'confirmed', 'declined')),
  constraint npi_suppressions_basis_check check (basis is null or basis in ('nppes', 'ainpi_files', 'unverified', 'manual'))
);
-- Upgrade an earlier draft in place (defensive; see the header).
alter table public.npi_suppressions add column if not exists basis text;
alter table public.npi_suppressions add column if not exists not_before timestamp(3);
alter table public.npi_suppressions add column if not exists overdue_alerted_at timestamp(3);
-- Read and written only by the app's own connection (the confirm cron); the
-- restricted roles get no grant on it.
alter table public.npi_suppressions add column if not exists reclassify_checked_at timestamp(3);
alter table public.npi_suppressions drop column if exists held_reason;
alter table public.npi_suppressions drop constraint if exists npi_suppressions_status_check;
alter table public.npi_suppressions add constraint npi_suppressions_status_check
  check (status in ('pending', 'applied', 'confirmed', 'declined'));
alter table public.npi_suppressions drop constraint if exists npi_suppressions_basis_check;
alter table public.npi_suppressions add constraint npi_suppressions_basis_check
  check (basis is null or basis in ('nppes', 'ainpi_files', 'unverified', 'manual'));

create unique index if not exists npi_suppressions_npi_key on public.npi_suppressions (npi);
create index if not exists npi_suppressions_status_idx on public.npi_suppressions (status);

alter table public.npi_suppressions enable row level security;

-- Supabase grants new public tables to the API roles by default. Take it back.
revoke all on table public.npi_suppressions from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ainpi_suppression_reader') then
    create role ainpi_suppression_reader login noinherit password 'REPLACE_READER_PASSWORD';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'ainpi_suppression_apply') then
    create role ainpi_suppression_apply login noinherit password 'REPLACE_APPLY_PASSWORD';
  end if;
end
$$;

grant usage on schema public to ainpi_suppression_reader, ainpi_suppression_apply;

-- Column-level grants: neither role can read requester_email or any other column.
grant select (npi) on public.npi_suppressions to ainpi_suppression_reader;
grant select (npi, status, requested_at, not_before) on public.npi_suppressions to ainpi_suppression_apply;
grant update (status, applied_at) on public.npi_suppressions to ainpi_suppression_apply;

drop policy if exists npi_suppressions_reader_select on public.npi_suppressions;
create policy npi_suppressions_reader_select on public.npi_suppressions
  for select to ainpi_suppression_reader
  using (status in ('pending', 'applied', 'confirmed')
         and (not_before is null or not_before <= (now() at time zone 'utc'))
         and basis is distinct from 'unverified');

drop policy if exists npi_suppressions_apply_select on public.npi_suppressions;
create policy npi_suppressions_apply_select on public.npi_suppressions
  for select to ainpi_suppression_apply
  using (status in ('pending', 'applied', 'confirmed')
         and (not_before is null or not_before <= (now() at time zone 'utc'))
         and basis is distinct from 'unverified');

-- The apply role can only move an active pending row to applied.
drop policy if exists npi_suppressions_apply_update on public.npi_suppressions;
create policy npi_suppressions_apply_update on public.npi_suppressions
  for update to ainpi_suppression_apply
  using (status = 'pending'
         and (not_before is null or not_before <= (now() at time zone 'utc'))
         and basis is distinct from 'unverified')
  with check (status = 'applied');

commit;

-- Verification (run after the block above; each must behave as noted):
--   set role ainpi_suppression_reader;
--   select npi from public.npi_suppressions;              -- works
--   select requester_email from public.npi_suppressions;  -- ERROR: permission denied
--   reset role;
--   set role ainpi_suppression_apply;
--   select requester_email from public.npi_suppressions;  -- ERROR: permission denied
--   reset role;
-- Then from frontend/: npx tsx scripts/probe-suppression-rls.ts
