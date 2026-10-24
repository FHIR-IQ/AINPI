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
--   * ainpi_suppression_apply   SELECT (npi, status, requested_at),
--                               UPDATE (status, applied_at). suppression-apply.yml.
--   * anon / authenticated / service_role (PostgREST): no privileges, and
--     RLS has no policy for them, so the REST API returns nothing.
--   * Rows with status 'held' are invisible to both restricted roles, so a
--     held request is not filtered until a person sets it to 'pending'.
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
  held_reason        text,
  had_page           boolean,
  requested_at       timestamp(3) not null default current_timestamp,
  applied_at         timestamp(3),
  confirm_checked_at timestamp(3),
  confirm_claimed_at timestamp(3),
  confirmed_at       timestamp(3),
  constraint npi_suppressions_pkey primary key (id),
  constraint npi_suppressions_npi_format check (npi ~ '^[0-9]{10}$'),
  constraint npi_suppressions_source_check check (source in ('form', 'email', 'manual')),
  constraint npi_suppressions_status_check check (status in ('pending', 'applied', 'confirmed', 'held'))
);
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
grant select (npi, status, requested_at) on public.npi_suppressions to ainpi_suppression_apply;
grant update (status, applied_at) on public.npi_suppressions to ainpi_suppression_apply;

drop policy if exists npi_suppressions_reader_select on public.npi_suppressions;
create policy npi_suppressions_reader_select on public.npi_suppressions
  for select to ainpi_suppression_reader
  using (status <> 'held');

drop policy if exists npi_suppressions_apply_select on public.npi_suppressions;
create policy npi_suppressions_apply_select on public.npi_suppressions
  for select to ainpi_suppression_apply
  using (status <> 'held');

-- The apply role can only move pending -> applied.
drop policy if exists npi_suppressions_apply_update on public.npi_suppressions;
create policy npi_suppressions_apply_update on public.npi_suppressions
  for update to ainpi_suppression_apply
  using (status = 'pending')
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
