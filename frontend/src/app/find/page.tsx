import type { Metadata } from 'next';

import Navbar from '@/components/Navbar';
import FindNearby from '@/components/find/FindNearby';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Find care near you, and see what the directory knows',
  description:
    'Search the federal provider directory by ZIP or by your location. See ' +
    'which care locations are listed near you, and which of them the ' +
    'directory cannot trace back to an organization.',
};

export default function FindPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="eyebrow mb-2">Find care</p>
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-4">
          What the federal directory lists near you
        </h1>
        <p className="lede measure mb-6">
          Enter a ZIP code or use your location. You will get the care locations
          the government&rsquo;s provider directory lists nearby, in distance
          order.
        </p>

        {/* Said before the search, not after. Someone looking for care needs to
            know what this is before they act on it. */}
        <div className="mb-8 border-l-2 border-signal pl-4 py-1 measure">
          <p className="text-sm text-gray-700">
            <strong>Read this first.</strong> This is an audit of a federal data
            file, not a live directory. It shows what the government&rsquo;s
            directory says, which is not the same as who is open, who is taking
            new patients, or who takes your insurance. Always call before you go.
          </p>
        </div>

        <FindNearby />

        <div className="mt-12 border-t border-gray-300 pt-6 text-xs text-gray-600 measure space-y-3">
          <p>
            <strong>Why some results say &ldquo;owner not listed&rdquo;.</strong>{' '}
            Every location in the directory is supposed to name the organization
            that runs it. Many do not. That is the gap this project measures, so
            rather than hide it, each result tells you whether the directory can
            say who runs that place.
          </p>
          <p>
            <strong>What you will not see.</strong> About 1.7% of locations in
            the federal file carry no coordinates at all. They cannot appear in
            a distance search, so a nearby practice may simply be missing rather
            than absent.
          </p>
          <p>
            Searching for a specific person instead of a place?{' '}
            <a href="/npd" className="text-primary-600 hover:underline">
              Search by name or NPI
            </a>
            . Want the numbers behind your county?{' '}
            <a href="/explorer" className="text-primary-600 hover:underline">
              Open the explorer
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
