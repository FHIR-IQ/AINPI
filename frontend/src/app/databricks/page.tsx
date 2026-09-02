import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { CURRENT_RELEASE } from '@/lib/release';

// Static. This page describes the share; it never queries it, so it cannot
// bill. Same contract as /npi and /developer.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI on Databricks',
  description:
    'Reference architecture, contents and quickstart for the CMS National Provider Directory release archive, published as Delta tables over OpenSharing and listed on Databricks Marketplace.',
  openGraph: {
    title: 'AINPI on Databricks: the provider directory release archive',
    description:
      'How the CMS National Provider Directory archive is built and shared: architecture, the six tables, and a quickstart for consumers with or without a Databricks account.',
    url: 'https://ainpi.dev/databricks',
    type: 'article',
  },
};

const TABLES = [
  ['practitioner', 'Individual providers, id is Practitioner-<NPI>'],
  ['practitioner_role', 'Practitioner to organization, with specialty'],
  ['organization', 'Groups, facilities and tax records'],
  ['organization_affiliation', 'Organization to organization edges'],
  ['location', 'Sites, with coordinates for 98% of rows'],
  ['endpoint', 'FHIR REST and Direct Trust addresses'],
] as const;

/**
 * Reference architecture. Drawn from the scripts rather than from a mental
 * model: every labelled box is a real file or a real object, and the dashed
 * region is exactly what lives in the Databricks account. The audit path on
 * the left is drawn separately because it does not touch Databricks at all,
 * which is a claim this project has to be able to make precisely.
 */
function ArchitectureDiagram() {
  const ink = '#171310';
  const muted = '#6b6259';
  const rule = '#d9d2c8';
  const blue = '#08519c';
  const signal = '#a8321c';

  const Box = ({
    x, y, w, h, title, sub, accent,
  }: { x: number; y: number; w: number; h: number; title: string; sub?: string; accent?: string }) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="#ffffff" stroke={accent ?? rule} strokeWidth={accent ? 1.5 : 1} />
      <text x={x + 12} y={y + (sub ? 21 : h / 2 + 4)} fontSize={13} fill={ink} className="font-sans" fontWeight={600}>
        {title}
      </text>
      {sub && (
        <text x={x + 12} y={y + 38} fontSize={11} fill={muted} className="font-sans">
          {sub}
        </text>
      )}
    </g>
  );

  const Arrow = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={muted} strokeWidth={1.25} markerEnd="url(#arrow)" />
  );

  return (
    <div className="overflow-x-auto border border-ink/15 rounded bg-white">
      <svg viewBox="0 0 940 660" width="940" className="max-w-none" role="img"
           aria-label="Architecture: CMS bulk export is ingested once, then splits into a BigQuery audit path that feeds ainpi.dev and the MCP server, and a parquet path that becomes Delta tables shared from Databricks to Marketplace and open Delta Sharing consumers.">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={muted} />
          </marker>
        </defs>

        <Box x={320} y={12} w={300} h={50} title="CMS NDH bulk export" sub="directory.cms.gov · manifest.json · 8 NDJSON files" accent={signal} />
        <Arrow x1={470} y1={62} x2={470} y2={94} />
        <Box x={320} y={96} w={300} h={50} title="analysis/fast_ingest_ndh.py" sub="zstd NDJSON, flattened to typed columns" />

        <line x1={470} y1={146} x2={470} y2={168} stroke={muted} strokeWidth={1.25} />
        <line x1={185} y1={168} x2={755} y2={168} stroke={muted} strokeWidth={1.25} />
        <Arrow x1={185} y1={168} x2={185} y2={210} />
        <Arrow x1={755} y1={168} x2={755} y2={210} />

        {/* Left: the audit. Nothing here touches Databricks. */}
        <text x={45} y={200} fontSize={11} fill={muted} className="font-sans" letterSpacing="0.08em">THE AUDIT</text>
        <Box x={45} y={212} w={280} h={50} title="BigQuery cms_npd" sub="32.5M FHIR resources, current release" />
        <Arrow x1={185} y1={262} x2={185} y2={294} />
        <Box x={45} y={296} w={280} h={50} title="analysis/h*.py" sub="54 registered hypotheses, 40 published" />
        <Arrow x1={185} y1={346} x2={185} y2={378} />
        <Box x={45} y={380} w={280} h={50} title="/api/v1 static JSON" sub="findings, states, crosswalk CSVs" />
        <Arrow x1={185} y1={430} x2={185} y2={462} />
        <Box x={45} y={464} w={280} h={62} title="ainpi.dev  ·  MCP server" sub="Vercel. No Databricks anywhere on this path." accent={blue} />

        {/* Right: the archive, inside the Databricks account. */}
        <rect x={430} y={186} width={480} height={330} rx={4} fill="none" stroke={blue} strokeWidth={1} strokeDasharray="5 4" />
        <text x={444} y={204} fontSize={11} fill={blue} className="font-sans" letterSpacing="0.08em">
          DATABRICKS ACCOUNT · AWS us-west-2
        </text>

        <Box x={615} y={212} w={280} h={50} title="Parquet export" sub="one file per resource per release" />
        <Arrow x1={755} y1={262} x2={755} y2={294} />
        <Box x={615} y={296} w={280} h={50} title="Unity Catalog volume" sub="analysis/databricks_publish.py --upload" />
        <Arrow x1={755} y1={346} x2={755} y2={378} />
        <Box x={615} y={380} w={280} h={54} title="Delta tables workspace.ainpi" sub="6 tables, PARTITIONED BY release_date" accent={blue} />
        <Arrow x1={755} y1={434} x2={755} y2={462} />
        <Box x={615} y={464} w={280} h={40} title="Share ainpi-ndh-archive" />

        <line x1={755} y1={504} x2={755} y2={534} stroke={muted} strokeWidth={1.25} />
        <line x1={555} y1={534} x2={845} y2={534} stroke={muted} strokeWidth={1.25} />
        <Arrow x1={555} y1={534} x2={555} y2={572} />
        <Arrow x1={845} y1={534} x2={845} y2={572} />
        <Box x={430} y={574} w={250} h={62} title="Databricks Marketplace" sub="Get instant access, into their own catalog" />
        <Box x={700} y={574} w={210} h={62} title="delta-sharing (Python)" sub="No Databricks account needed" />

        <text x={45} y={574} fontSize={11} fill={muted} className="font-sans">Every box is a real file or a real object.</text>
        <text x={45} y={594} fontSize={11} fill={muted} className="font-sans">The two paths share an ingest and nothing else.</text>
      </svg>
    </div>
  );
}

export default function DatabricksPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="rise">
          <p className="eyebrow mb-3">Integration · OpenSharing</p>
          <h1 className="text-3xl sm:text-4xl mb-4 text-balance">
            The provider directory archive, on Databricks
          </h1>
          <p className="lede measure">
            CMS publishes the National Provider Directory as a bulk export and
            serves only the current one. When a new release lands, the previous
            one stops existing. This is every release we have caught, kept as
            Delta tables partitioned by release, so comparing two versions is a{' '}
            <code className="font-mono text-[0.95em]">WHERE</code> clause rather
            than a re-download and a re-parse.
          </p>
          <p className="mt-4 measure text-ink/80">
            It is free. The underlying federal files are US government works and
            carry no copyright, and the extraction code is Apache-2.0.
          </p>
        </div>

        <section className="mt-12">
          <h2 className="text-2xl mb-2">Reference architecture</h2>
          <p className="measure text-ink/80 mb-5">
            One ingest, two paths. The audit runs on BigQuery and publishes to
            the web. The archive runs on Databricks and publishes to consumers.
            They share the ingest and nothing else, which is why the MCP server
            keeps answering when the warehouse is asleep.
          </p>
          <ArchitectureDiagram />
        </section>

        <section className="mt-12">
          <h2 className="text-2xl mb-2">What is in it</h2>
          <p className="measure text-ink/80 mb-5">
            Six tables, one per FHIR resource type, each partitioned by{' '}
            <code className="font-mono text-[0.95em]">release_date</code>. The
            current CMS release is {CURRENT_RELEASE}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-ink/15 text-left">
                  <th className="py-2 pr-4 font-semibold">Table</th>
                  <th className="py-2 font-semibold">What it holds</th>
                </tr>
              </thead>
              <tbody>
                {TABLES.map(([name, what]) => (
                  <tr key={name} className="border-b border-ink/10">
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{name}</td>
                    <td className="py-2 text-ink/80">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 measure text-ink/80">
            Each row keeps the full FHIR resource as JSON alongside flattened
            columns for the fields worth querying directly, so a question the
            flattening did not anticipate is still answerable from the same row.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl mb-2">Get it</h2>
          <p className="measure text-ink/80 mb-5">
            Two ways in, and the second needs no Databricks account at all.
          </p>

          <h3 className="text-lg mt-6 mb-2">From Databricks Marketplace</h3>
          <p className="measure text-ink/80 mb-3">
            Find <em>CMS National Provider Directory: Release Archive</em>, take
            Get instant access, and the tables mount into a catalog in your own
            workspace. Then query them like any other table.
          </p>
          <pre className="overflow-x-auto text-xs bg-white border border-ink/15 rounded p-4 font-mono">
{`SELECT release_date, count(*) AS practitioners
FROM ainpi_release_archive.ainpi.practitioner
GROUP BY release_date
ORDER BY release_date;`}
          </pre>

          <h3 className="text-lg mt-8 mb-2">Without a Databricks account</h3>
          <p className="measure text-ink/80 mb-3">
            The share is open Delta Sharing, so any client that speaks the
            protocol can read it from a credential file. Request one at{' '}
            <a href="mailto:gene@fhiriq.com" className="underline">gene@fhiriq.com</a>.
          </p>
          <pre className="overflow-x-auto text-xs bg-white border border-ink/15 rounded p-4 font-mono">
{`pip install delta-sharing

import delta_sharing
url = "ainpi.share#ainpi-ndh-archive.ainpi.practitioner"
df = delta_sharing.load_as_pandas(url, limit=1000)`}
          </pre>
          <p className="mt-3 measure text-ink/80">
            Filter on <code className="font-mono text-[0.95em]">release_date</code>{' '}
            before anything else. Partition pruning is a hint to the client, not
            a guarantee from the server, so a query without it can pull every
            release when you wanted one.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl mb-2">Read this before you write a diff</h2>
          <p className="measure text-ink/80">
            CMS regenerates <code className="font-mono text-[0.95em]">Endpoint</code>{' '}
            and <code className="font-mono text-[0.95em]">Location</code> resource
            ids on every export. Join two releases on id and you get 100% churn
            every time, which is an artifact of id minting rather than anything
            that happened in the world.
          </p>
          <ul className="mt-4 space-y-2 measure text-ink/80 list-disc pl-5">
            <li>
              <strong>Practitioner ids are stable</strong>, at 100% across
              releases, because the id is derived from the NPI. Stable ids do not
              mean unchanged records: of 20,000 practitioners present in two
              releases, zero were byte-identical.
            </li>
            <li>
              <strong>Endpoint rejoins on address</strong> at 100.0%. Use that,
              not the id.
            </li>
            <li>
              <strong>Location has no reliable cross-release key.</strong> The
              best composite matches 73.5% after normalising case and
              punctuation. Any Location diff has to state its match rate.
            </li>
          </ul>
          <p className="mt-4 measure text-ink/80">
            The table comments carry these warnings too, so they travel with the
            data rather than living only here. Full method in the{' '}
            <Link href="/methodology" className="underline">methodology</Link>.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl mb-2">Roadmap</h2>
          <dl className="space-y-4 measure text-ink/80">
            <div>
              <dt className="font-semibold text-ink">Current quarter</dt>
              <dd className="mt-1">
                Archive live with two releases over OpenSharing. MCP server
                submitted for Marketplace validation. Account allow-listed as a
                public provider on 2026-08-31, so the archive listing moves from
                private to public.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Next quarter</dt>
              <dd className="mt-1">
                Ingest the next CMS release into the archive within two weeks of
                publication. Rotate the sharing recipient token before it expires
                on 2026-11-21. A Cloudflare R2 migration is written and tested,
                held until a bill actually shows sharing egress.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Known limitation</dt>
              <dd className="mt-1">
                The Location cross-release key above. It is a property of what
                CMS publishes rather than a bug we can fix, so it is documented
                rather than scheduled.
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12 border-t border-ink/10 pt-6">
          <h2 className="text-2xl mb-3">Where the numbers come from</h2>
          <ul className="space-y-2 measure text-ink/80">
            <li>
              <Link href="/findings" className="underline">Findings</Link> — every
              published measurement, each with its compute script.
            </li>
            <li>
              <Link href="/methodology" className="underline">Methodology</Link> —
              how a hypothesis gets registered before the number exists.
            </li>
            <li>
              <Link href="/data-sources" className="underline">Data sources</Link> —
              every dataset used, considered or rejected, with licence terms.
            </li>
            <li>
              <Link href="/developer" className="underline">Developer</Link> — the
              stable <code className="font-mono text-xs">/api/v1</code> contract
              and the MCP tools, which are the left-hand path in the diagram.
            </li>
          </ul>
          <p className="mt-5 measure text-sm text-ink/70">
            This is a research project. Verify any number against the primary
            source before it informs a decision, and tell us when one is wrong:{' '}
            <a href="mailto:gene@fhiriq.com" className="underline">gene@fhiriq.com</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
