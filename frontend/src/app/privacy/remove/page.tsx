import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import RemovalForm from './RemovalForm';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Remove an NPI from AINPI',
  description:
    'Ask for an individual provider page and per-NPI rows to be removed from ainpi.dev. Requests are processed automatically within 7 days.',
  robots: { index: false },
};

export default function RemovalPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <p className="eyebrow mb-2">Privacy</p>
        <h1 className="text-3xl font-serif text-ink mb-4">Remove an NPI from AINPI</h1>
        <div className="measure text-sm text-gray-700 space-y-3 mb-8">
          <p>
            If you are the provider identified by an NPI, or authorized to act for
            them, you can ask for that NPI to be removed from ainpi.dev. Removal
            covers the individual page at <code>/npi/&lt;npi&gt;</code>, the NPI&apos;s
            rows in our downloadable files and API, and AINPI&apos;s search results.
          </p>
          <p>
            It does not change aggregate counts, which still include the record, and
            it does not change the CMS source data or any other service. Requests are
            processed automatically within 7 days, and we email you when removal is
            complete.
          </p>
        </div>
        <section className="bg-white border border-gray-200 p-6">
          <RemovalForm />
        </section>
        <p className="text-xs text-gray-500 mt-6">
          See the <Link href="/privacy" className="underline">privacy policy</Link> for
          what we store about a request.
        </p>
      </main>
    </div>
  );
}
