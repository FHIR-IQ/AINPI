-- Self-serve API trials (/trial). Run once for project hspqvcoinujtfodreqaf,
-- by Gene or with his go-ahead, BEFORE the code that reads api_keys.expires_at
-- deploys: Prisma selects every mapped column, so without the column every
-- API-key lookup fails and keyed callers silently drop to anonymous.
-- Keep in sync by hand with `model TrialSignup` and `ApiKey.expiresAt` in
-- ../schema.prisma. Use this file, not `prisma db push`. Safe to re-run.

begin;

-- 1. Keys can expire. Additive and nullable: existing keys are unaffected.
alter table public.api_keys add column if not exists expires_at timestamp(3);

-- 2. Trial sign-ups. Contact details never leave the app's own connection.
create table if not exists public.trial_signups (
  id               text         not null,
  organization     text         not null,
  contact_name     text         not null,
  email            text         not null,
  email_norm       text         not null,
  role             text,
  use_case         text,
  api_key_id       text,
  expires_at       timestamp(3) not null,
  reminder_sent_at timestamp(3),
  ended_sent_at    timestamp(3),
  converted_at     timestamp(3),
  revoked_at       timestamp(3),
  ip_address       text,
  user_agent       text,
  created_at       timestamp(3) not null default current_timestamp,
  constraint trial_signups_pkey primary key (id)
);

-- For a table created by an earlier draft of this file.
alter table public.trial_signups add column if not exists revoked_at timestamp(3);

create unique index if not exists trial_signups_email_norm_key on public.trial_signups (email_norm);
create index if not exists trial_signups_expires_at_idx on public.trial_signups (expires_at);

alter table public.trial_signups enable row level security;
revoke all on table public.trial_signups from public, anon, authenticated, service_role;

commit;

-- Verification:
--   select column_name from information_schema.columns
--     where table_name = 'api_keys' and column_name = 'expires_at';            -- one row
--   select relrowsecurity from pg_class where relname = 'trial_signups';      -- true
--   select grantee from information_schema.role_table_grants
--     where table_name = 'trial_signups'
--       and grantee in ('anon', 'authenticated', 'service_role');              -- no rows
