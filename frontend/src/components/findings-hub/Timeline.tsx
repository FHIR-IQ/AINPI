import Link from 'next/link';
import type { TimelineEntry } from '@/lib/hub-feed';
import { TimelineEntryRow } from './TimelineEntry';

interface Props {
  entries: TimelineEntry[];
}

export function Timeline({ entries }: Props) {
  return (
    <section className="bg-white border-t border-gray-200 px-5 py-6 sm:px-8" aria-labelledby="recent-updates-heading">
      <header className="flex items-baseline justify-between mb-3">
        <h2
          id="recent-updates-heading"
          className="text-xs font-bold uppercase tracking-wider text-gray-600"
        >
          Recent updates
        </h2>
        <span className="text-xs text-gray-400">
          Showing last {Math.min(entries.length, 10)} ·{' '}
          <Link href="/subscribe" className="text-primary-600 hover:underline">
            Subscribe
          </Link>
        </span>
      </header>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No recent updates yet.</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {entries.slice(0, 10).map((entry) => (
            <TimelineEntryRow key={entry.href} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
