import Link from 'next/link';
import type { LeadStoryItem } from '@/lib/hub-feed';

interface Props {
  lead: LeadStoryItem;
}

export function HomepageLatestStrip({ lead }: Props) {
  return (
    <div className="bg-white border-t border-gray-200 px-5 sm:px-8 py-3">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
        <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-red-700 text-white text-[10px] font-bold uppercase tracking-wider w-fit">
          Latest
        </span>
        <Link href={lead.href} className="flex-1 text-gray-900 hover:text-red-700">
          <span className="font-semibold">{lead.title}</span>
          <span className="text-gray-500 ml-2 text-xs tabular-nums">· <span>{lead.date}</span></span>
        </Link>
        <Link href="/findings" className="text-xs text-primary-600 hover:underline whitespace-nowrap">
          View all updates →
        </Link>
      </div>
    </div>
  );
}
