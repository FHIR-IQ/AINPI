import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import AuthorByline from '@/components/AuthorByline';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Data sources — AINPI',
  description:
    'Every public dataset AINPI ingests, considers, or rejects, with primary-source URLs, license terms, refresh cadence, and the AINPI hypothesis each maps to. Citation-grade reference for auditors, researchers, and state Medicaid teams.',
  openGraph: {
    title: 'Data sources — AINPI',
    description:
      'Every public dataset AINPI ingests, considers, or rejects, with primary-source URLs and citation context.',
    url: 'https://ainpi.dev/data-sources',
    type: 'article',
  },
};

interface SourceRow {
  name: string;
  url: string;
  description: string;
  license: string;
  cadence: string;
  /** What AINPI does with it. */
  ainpiStatus: 'ingested' | 'roadmap' | 'out-of-scope' | 'limited';
  /** Mapped findings or hypotheses. */
  mappedTo: string;
  /** Why if rejected, or how if ingested. */
  notes: string;
}

const FEDERAL_SCREENING: SourceRow[] = [
  {
    name: 'NPPES (National Plan and Provider Enumeration System)',
    url: 'https://npiregistry.cms.hhs.gov/',
    description: 'Federal registry of NPIs, mandatory under HIPAA. Self-attested provider demographics, taxonomy, and addresses.',
    license: 'Public domain',
    cadence: 'Continuous; full file dissemination monthly',
    ainpiStatus: 'ingested',
    mappedTo: 'H10, H11, H13 — match rate, name agreement, specialty consistency',
    notes: 'Source: bigquery-public-data.nppes.npi_raw (BigQuery public dataset, dated). Switch-aware match against all 15 taxonomy slots per provider, not just slot 1.',
  },
  {
    name: 'OIG LEIE (List of Excluded Individuals/Entities)',
    url: 'https://oig.hhs.gov/exclusions/leie-database-supplement-downloads/',
    description: 'Federal database of providers excluded from Medicare, Medicaid, and all other Federal health care programs under SSA §§ 1128 and 1156.',
    license: 'Public domain',
    cadence: 'Monthly full file + monthly supplement',
    ainpiStatus: 'ingested',
    mappedTo: 'H24 — LEIE-NDH match. Composite weight 1.5 in H23 high-risk cohort.',
    notes: 'Direct download: oig.hhs.gov/exclusions/downloadables/UPDATED.csv. ~83K active rows; ~10.8% have a populated NPI (the rest are pre-NPI-era). Filter REINDATE = "00000000" to drop reinstatements.',
  },
  {
    name: 'SAM.gov Exclusions (formerly EPLS)',
    url: 'https://sam.gov/content/exclusions',
    description: 'Federal-wide debarment and suspension list across all federal contracting and assistance programs. Required check under 42 CFR § 455.436.',
    license: 'Public domain (US federal government work)',
    cadence: 'Daily updates; Public Extract V2 published as CSV',
    ainpiStatus: 'ingested',
    mappedTo: 'H25 — SAM-NDH match. Composite weight 1.5 in H23 high-risk cohort (independent of LEIE).',
    notes: 'Loaded from the SAM.gov Public Extract V2 (sam.gov/data-services/Exclusions/Public V2). 167K rows, ~4% with a real-format NPI; the rest are non-healthcare exclusions (OFAC sanctions, EPA contractor debarment). HHS slice overlaps OIG LEIE; OPM slice (FEHBP debarment under 5 USC 8902a) is net-new federal-screening signal not visible from LEIE alone.',
  },
  {
    name: 'SSA Death Master File (DMF)',
    url: 'https://www.ssa.gov/dataexchange/request_dmf.html',
    description: 'Social Security Administration record of deceased individuals.',
    license: 'Limited Access DMF requires Section 1110 certification under 42 USC § 1306c',
    cadence: 'Weekly updates to subscribed users',
    ainpiStatus: 'out-of-scope',
    mappedTo: '—',
    notes: 'The Public DMF excludes deaths within the prior 3 years. Full DMF requires NTIS subscription and SSA certification — a procurement effort each state Medicaid agency manages independently.',
  },
  {
    name: 'CMS Preclusion List',
    url: 'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/chain-ownership-system-pecos/preclusion-list',
    description: 'Providers precluded from receiving payment for Medicare Advantage items, services, or Part D drugs. Created by 42 CFR § 422.222 / § 423.120.',
    license: 'Restricted — Medicare Advantage Part C plans and Part D sponsors only',
    cadence: 'Monthly, first business day of the month',
    ainpiStatus: 'out-of-scope',
    mappedTo: '—',
    notes: 'NOT publicly downloadable. AINPI cannot ingest this list. State Medicaid agencies relying on Preclusion signal must coordinate with their MCOs directly. Documenting it here so the limitation is explicit.',
  },
];

const AUDIT_SOURCES: SourceRow[] = [
  {
    name: 'CMS National Provider Directory (NPD)',
    url: 'https://directory.cms.gov/',
    description: 'FHIR R4 NDJSON bulk export of the federal provider directory: 6 resource types, 27.2M resources at the 2026-04-09 release.',
    license: 'Public domain (US federal government work)',
    cadence: 'Periodic — most recent release pinned per audit',
    ainpiStatus: 'ingested',
    mappedTo: 'All findings. The NDH artifact is what AINPI audits.',
    notes: 'Distributed as zstd-compressed NDJSON (2.8 GB compressed, 40.7 GB uncompressed). Loaded into BigQuery as resource:JSON columns plus extracted flat _* fields per resource type.',
  },
  {
    name: 'NUCC Healthcare Provider Taxonomy Code Set',
    url: 'https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40',
    description: 'Standardized 900+ specialty classification codes used by NPPES Practitioner.qualification and CMS-Medicare crosswalks.',
    license: 'Public; permission required for redistribution',
    cadence: 'Quarterly',
    ainpiStatus: 'ingested',
    mappedTo: 'H12 — taxonomy validity. Companion to H13.',
    notes: 'Source: bigquery-public-data.nppes.healthcare_provider_taxonomy_code_set_170. Pinned to v17.0 for the 2026-04-09 audit.',
  },
  {
    name: 'CMS Medicare Provider and Supplier Taxonomy Crosswalk',
    url: 'https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/medicare-provider-and-supplier-taxonomy-crosswalk',
    description: 'Authoritative CMS crosswalk between NUCC taxonomy codes and CMS Medicare specialty codes. 1-to-many for both directions.',
    license: 'Public domain',
    cadence: 'Quarterly',
    ainpiStatus: 'ingested',
    mappedTo: 'H13 — bridges PractitionerRole.specialty (CMS Medicare codes) to Practitioner.qualification (NUCC codes). Pinned to October 2025 release.',
    notes: 'CSV has embedded newlines that BigQuery\'s default loader rejects — pipeline parses with Python csv module (RFC-4180-compliant) and streams as NDJSON.',
  },
  {
    name: 'Live FHIR endpoints (probe)',
    url: 'https://github.com/FHIR-IQ/ainpi-probe',
    description: 'Empirical L0–L7 reachability scoring of every Endpoint.address declared in the NDH bulk export.',
    license: 'Apache-2.0 (the crawler code); endpoints themselves are public APIs',
    cadence: 'Out-of-band; monthly today, weekly target',
    ainpiStatus: 'ingested',
    mappedTo: 'H1–H5 endpoint liveness; H22 network adequacy gauge',
    notes: 'Polite crawler — 1 req/sec/host, named User-Agent, documented source IP. Runs on a dedicated host outside CI runners to avoid bad-neighbor behavior.',
  },
];

const CONSIDERED_NOT_INGESTED: SourceRow[] = [
  {
    name: 'CAQH ProView',
    url: 'https://proview.caqh.org/',
    description: 'Commercial credentialing source maintained by the Council for Affordable Quality Healthcare.',
    license: 'Subscription / member access only',
    cadence: 'Continuous',
    ainpiStatus: 'out-of-scope',
    mappedTo: '—',
    notes: 'Not in the federal NDH ingestion pipeline (commercial-payer data). See /insights for the full provenance discussion of the CAQH gap.',
  },
  {
    name: 'CMS Open Payments',
    url: 'https://openpaymentsdata.cms.gov/',
    description: 'Public-domain transparency database of payments from drug/device manufacturers to providers under Section 6002 of the ACA.',
    license: 'Public domain',
    cadence: 'Annual + interim updates',
    ainpiStatus: 'roadmap',
    mappedTo: 'Future — provider-context enrichment, not directory accuracy. Lower priority than 42 CFR § 455.436 sources.',
    notes: 'Could enrich /findings/[slug] pages with payments context per NPI. Not relevant to revalidation decisions per se.',
  },
  {
    name: 'CMS Medicare Provider Utilization & Payment',
    url: 'https://data.cms.gov/provider-summary-by-type-of-service',
    description: 'Aggregated services rendered per provider per HCPCS code under Medicare Part B.',
    license: 'Public domain',
    cadence: 'Annual',
    ainpiStatus: 'out-of-scope',
    mappedTo: '—',
    notes: 'Claims-derived; AINPI is provider-directory only. Out of scope.',
  },
  {
    name: 'HRSA HPSA / MUA / NHSC',
    url: 'https://data.hrsa.gov/',
    description: 'Health Professional Shortage Areas, Medically Underserved Areas, and National Health Service Corps participants.',
    license: 'Public domain',
    cadence: 'Continuous',
    ainpiStatus: 'roadmap',
    mappedTo: 'Future — geography enrichment for state-scoped pages (rural / underserved-area context).',
    notes: 'Could surface "% of state Medicaid roster in an HPSA" alongside state-scoped findings.',
  },
  {
    name: 'State Medicaid exclusion / sanction lists',
    url: 'https://oig.hhs.gov/exclusions/state-exclusion-list/',
    description: 'Each state publishes its own provider exclusion list. Format and access vary widely across the 43+ state-published lists.',
    license: 'Public per state',
    cadence: 'Varies (monthly to ad-hoc)',
    ainpiStatus: 'roadmap',
    mappedTo: 'Future — state-specific high-risk cohort enrichment for /states/[state] pages.',
    notes: 'Aggregating these would be a meaningful contribution. Per-state ingestion adapters needed; some states publish CSV, others PDF, others web-scrape only.',
  },
];

function StatusBadge({ status }: { status: SourceRow['ainpiStatus'] }) {
  const styles = {
    ingested: 'bg-green-100 text-green-800',
    roadmap: 'bg-amber-100 text-amber-800',
    'out-of-scope': 'bg-gray-100 text-gray-700',
    limited: 'bg-blue-100 text-blue-800',
  };
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ' +
        styles[status]
      }
    >
      {status}
    </span>
  );
}

function SourceTable({
  rows,
  title,
  subtitle,
}: {
  rows: SourceRow[];
  title: string;
  subtitle: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-600 mb-4">{subtitle}</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.name}
            className="bg-white rounded-lg border border-gray-200 p-4"
          >
            <div className="flex items-start justify-between gap-4 mb-2">
              <h3 className="text-base font-semibold text-gray-900">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                  className="hover:underline"
                >
                  {r.name}
                </a>
              </h3>
              <StatusBadge status={r.ainpiStatus} />
            </div>
            <p className="text-sm text-gray-700 mb-3">{r.description}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <div>
                <dt className="text-gray-500 font-medium">License</dt>
                <dd className="text-gray-700">{r.license}</dd>
              </div>
              <div>
                <dt className="text-gray-500 font-medium">Refresh cadence</dt>
                <dd className="text-gray-700">{r.cadence}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500 font-medium">Mapped to AINPI</dt>
                <dd className="text-gray-700">{r.mappedTo}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500 font-medium">Notes</dt>
                <dd className="text-gray-700">{r.notes}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DataSourcesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Data sources</h1>
        <p className="text-gray-700 mb-2">
          Every public dataset AINPI ingests, considers, or rejects — with
          primary-source URLs, license terms, refresh cadence, and the
          hypothesis each maps to.
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This page exists because methodology trust starts with{' '}
          <em>showing the inputs</em>. State Medicaid agencies, auditors, and
          researchers can verify each row against its primary source. If a row
          is wrong, file an{' '}
          <a
            href="https://github.com/FHIR-IQ/AINPI/issues/new/choose"
            target="_blank"
            rel="noopener"
            className="underline"
          >
            issue
          </a>
          .
        </p>

        <AuthorByline lastReviewed="2026-04-29" />

        <SourceTable
          title="Federal screening databases (42 CFR § 455.436)"
          subtitle="The four databases state Medicaid agencies are legally required to check for provider identity and exclusion status, plus the CMS Preclusion List for completeness."
          rows={FEDERAL_SCREENING}
        />

        <SourceTable
          title="Audit inputs"
          subtitle="The data AINPI joins, validates, and aggregates to produce its published findings."
          rows={AUDIT_SOURCES}
        />

        <SourceTable
          title="Considered, not ingested"
          subtitle="Datasets that come up in directory-quality conversations but sit outside the current AINPI scope. Documented here so the boundary is explicit."
          rows={CONSIDERED_NOT_INGESTED}
        />

        <section className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            How to add a new data source
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-800">
            <li>
              <strong>Open an issue</strong> using the &quot;new metric proposal&quot;
              or &quot;data source addition&quot; template. Include the primary-source
              URL, license, refresh cadence, and which AINPI hypothesis it
              would inform.
            </li>
            <li>
              <strong>Pre-register</strong> the methodology (null hypothesis,
              denominator) before any numbers are computed. Add a row to{' '}
              <code>frontend/src/data/findings.ts</code> with{' '}
              <code>status: &apos;pre-registered&apos;</code>.
            </li>
            <li>
              <strong>Ship an ingestion script</strong> at{' '}
              <code>analysis/ingest_&lt;source&gt;.py</code> with a polite
              User-Agent, RFC-compliant CSV parsing, and an explicit BigQuery
              destination. License headers required.
            </li>
            <li>
              <strong>Publish the finding</strong> by writing to{' '}
              <code>frontend/public/api/v1/findings/&lt;slug&gt;.json</code>.
              Methodology version bump goes in{' '}
              <code>docs/methodology/index.md</code>.
            </li>
            <li>
              <strong>Add a row to this page</strong> so the addition is
              visible alongside its peers.
            </li>
          </ol>
          <p className="mt-3 text-sm text-gray-700">
            Source code:{' '}
            <a
              href="https://github.com/FHIR-IQ/AINPI/tree/main/analysis"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              analysis/
            </a>
            . PRs welcome under Apache-2.0.
          </p>
        </section>

        <footer className="mt-12 pt-8 border-t text-xs text-gray-500 space-y-1">
          <p>
            Related:{' '}
            <a href="/methodology" className="underline">
              methodology
            </a>
            {' · '}
            <a href="/findings" className="underline">
              findings
            </a>
            {' · '}
            <a href="/smd-revalidation" className="underline">
              for state Medicaid
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
