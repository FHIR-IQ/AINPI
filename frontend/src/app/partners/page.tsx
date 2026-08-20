import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { COMMUNITIES, PARTNERS } from '@/data/partners';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Related work',
  description:
    'People and organizations working on provider and payer directory data from angles this project does not cover, with links to their research and what each of them measures that we do not.',
  openGraph: {
    title: 'Related work on provider and payer directory data',
    description:
      'Who else is measuring this, what they cover that we do not, and where their findings meet ours.',
    url: 'https://ainpi.dev/partners',
    type: 'article',
  },
};

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export default function PartnersPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow mb-3">Related work</p>
        <h1 className="mb-4 text-balance text-4xl">
          Other people measuring this
        </h1>
        <p className="lede measure mb-3">
          This project audits one federal file. That is a narrow slice of the
          problem, and the people below cover parts of it we do not touch. Their
          work is worth reading on its own terms, not as a supplement to ours.
        </p>
        <p className="measure mb-10 text-sm text-gray-600">
          Every link here was opened and read, and every quotation is verbatim
          from the piece it cites. Listing someone is not a claim of endorsement
          in either direction, and nobody listed has reviewed or approved what
          we publish.
        </p>

        <div className="space-y-10">
          {PARTNERS.map((p) => (
            <section key={p.name} className="border border-gray-300 bg-white p-6">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
                <h2 className="font-serif text-2xl text-ink">
                  <a href={p.url} className="hover:text-signal" rel="noopener">
                    {p.name}
                  </a>
                </h2>
                {p.person && (
                  <p className="text-sm text-gray-600">
                    {p.person}
                    {p.role ? `, ${p.role}` : ''}
                  </p>
                )}
              </div>

              <p className="measure mb-3 text-sm text-gray-700">{p.what}</p>

              <div className="mb-5 border-l-2 border-primary-200 pl-4">
                <p className="eyebrow mb-1">What they cover that we do not</p>
                <p className="measure text-sm text-gray-700">{p.why}</p>
              </div>

              <ul className="space-y-4">
                {p.links.map((l) => (
                  <li key={l.url} className="border-t border-gray-200 pt-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <a
                        href={l.url}
                        rel="noopener"
                        className="font-medium text-primary-700 underline"
                      >
                        {l.title}
                      </a>
                      <span className="font-mono text-xs tabular-nums text-gray-500">
                        {fmtDate(l.date)}
                      </span>
                    </div>
                    {l.quote && (
                      <blockquote className="measure mt-2 border-l-2 border-gray-300 pl-3 text-sm italic text-gray-700">
                        “{l.quote}”
                      </blockquote>
                    )}
                    {l.relatedTo && (
                      <p className="mt-2 text-sm text-gray-600">
                        Meets ours at{' '}
                        <Link
                          href={l.relatedTo.href}
                          className="text-primary-700 underline"
                        >
                          {l.relatedTo.label}
                        </Link>
                        .
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="mt-14">
          <h2 className="mb-1 font-serif text-2xl text-ink">
            Where this gets discussed
          </h2>
          <p className="measure mb-6 text-sm text-gray-600">
            Venues rather than publications. Most of what we know about what
            the directory is <em>meant</em> to do, as opposed to what it
            contains, came out of these rooms.
          </p>

          <div className="space-y-4">
            {COMMUNITIES.map((c) => (
              <div key={c.name} className="border border-gray-300 bg-white p-5">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
                  <h3 className="font-medium text-ink">
                    {c.url ? (
                      <a href={c.url} rel="noopener" className="hover:text-signal">
                        {c.name}
                      </a>
                    ) : (
                      c.name
                    )}
                  </h3>
                  {c.cadence && (
                    <span className="text-xs text-gray-500">{c.cadence}</span>
                  )}
                </div>
                <p className="measure text-sm text-gray-700">{c.what}</p>
                <p className="measure mt-2 text-sm text-gray-600">
                  <span className="eyebrow mr-2">Getting in</span>
                  {c.joinNote}
                </p>
                {c.links?.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    {c.links.map((l) => (
                      <li key={l.url}>
                        <a
                          href={l.url}
                          rel="noopener"
                          className="text-primary-700 underline"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 border border-gray-300 bg-white p-6">
          <h2 className="mb-2 font-serif text-2xl text-ink">
            Working on this too?
          </h2>
          <p className="measure text-sm text-gray-700">
            If you publish research on provider or payer directory data and want
            it listed, open an issue. The bar is that the work is public and
            that a reader can check it. We will link people we disagree with,
            and we would rather say where we disagree than leave them out.
          </p>
          <p className="measure mt-3 text-sm text-gray-700">
            <a
              href="https://github.com/FHIR-IQ/AINPI/issues/new/choose"
              className="text-primary-700 underline"
            >
              Open an issue on GitHub
            </a>{' '}
            or start from{' '}
            <Link href="/primer" className="text-primary-700 underline">
              the primer
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
