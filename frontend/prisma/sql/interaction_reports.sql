-- interaction_reports: the AINPI sandbox of the NPD Endpoint Feedback API
-- proposal v0.2 (POST/GET /api/v1/interaction-reports, MCP report_interaction).
-- Run once for project hspqvcoinujtfodreqaf, by Gene or with his go-ahead.
-- Keep in sync by hand with `model InteractionReport` in ../schema.prisma.
--
-- Access model:
--   * The app's Prisma connection (role `postgres`, the owner) writes and
--     reads reports. A reporter only ever reads its own (enforced in
--     src/lib/interaction-report-store.ts).
--   * anon / authenticated / service_role: no privileges and no RLS policy,
--     so the REST API returns nothing.
--
-- Use this file, not `prisma db push`, which would leave the table readable
-- through the REST API. Safe to re-run. Until it has run, submissions get 503.

begin;

create table if not exists public.interaction_reports (
  id                      text         not null,
  report_id               text         not null,
  reporter_participant_id text         not null,
  reporter_key_id         text         not null,
  body_hash               text         not null,
  body                    jsonb        not null,
  receipt                 jsonb        not null,
  received_at             timestamp(3) not null,
  constraint interaction_reports_pkey primary key (id)
);

create unique index if not exists interaction_reports_reporter_participant_id_report_id_key
  on public.interaction_reports (reporter_participant_id, report_id);

create index if not exists interaction_reports_received_at_idx
  on public.interaction_reports (received_at);

alter table public.interaction_reports enable row level security;

revoke all on table public.interaction_reports from public, anon, authenticated, service_role;

commit;

-- Verification:
--   select relrowsecurity from pg_class where relname = 'interaction_reports';   -- true
--   select grantee from information_schema.role_table_grants
--     where table_name = 'interaction_reports'
--       and grantee in ('anon', 'authenticated', 'service_role');                 -- no rows
