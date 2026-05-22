import Link from 'next/link';
import type { TimelineEntry, TimelineCategory } from '@/lib/hub-feed';
import { StatusPill } from './StatusPill';

interface Props {
  entry: TimelineEntry;
}

const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  finding: 'Finding',
  update: 'Update',
  article: 'Article',
  methodology: 'Methodology',
};

const CATEGORY_RULE: Record<TimelineCategory, string> = {
  finding: 'border-l-red-700',
  update: 'border-l-blue-700',
  article: 'border-l-purple-700',
  methodology: 'border-l-gray-400',
};

const CATEGORY_CHIP: Record<TimelineCategory, string> = {
  finding: 'bg-red-50 text-red-800 ring-red-200',
  update: 'bg-blue-50 text-blue-800 ring-blue-200',
  article: 'bg-purple-50 text-purple-800 ring-purple-200',
  methodology: 'bg-gray-50 text-gray-700 ring-gray-200',
};

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

export function TimelineEntryRow({ entry }: Props) {
  const hRange = entry.hNumbers?.length
    ? entry.hNumbers.length === 1
      ? entry.hNumbers[0]
      : `${entry.hNumbers[0]}–${entry.hNumbers[entry.hNumbers.length - 1]}`
    : null;
  return (
    <li className="flex gap-3 py-3">
      <time
        dateTime={entry.date}
        className="w-14 shrink-0 text-right text-xs text-gray-500 tabular-nums pt-0.5"
      >
        {shortDate(entry.date)}
      </time>
      <div className={`flex-1 border-l-2 pl-3 ${CATEGORY_RULE[entry.category]}`}>
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ring-1 ${CATEGORY_CHIP[entry.category]}`}
          >
            {CATEGORY_LABEL[entry.category]}
            {hRange ? ` · ${hRange}` : null}
          </span>
          {entry.status ? <StatusPill status={entry.status} /> : null}
        </div>
        <Link
          href={entry.href}
          className="block text-sm font-bold text-gray-900 hover:text-primary-700 leading-snug"
        >
          {entry.title}
        </Link>
        {entry.summary ? (
          <p className="mt-0.5 text-xs text-gray-600 leading-snug">{entry.summary}</p>
        ) : null}
      </div>
    </li>
  );
}
