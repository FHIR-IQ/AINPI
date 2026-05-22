import type { TimelineStatus } from '@/lib/hub-feed';

interface Props {
  status: TimelineStatus;
}

const LABEL: Record<TimelineStatus, string> = {
  published: 'PUB',
  'pre-registered': 'PRE',
  null: 'NULL',
};

const STYLE: Record<TimelineStatus, string> = {
  published: 'bg-green-100 text-green-800 ring-green-200',
  'pre-registered': 'bg-gray-100 text-gray-700 ring-gray-200',
  null: 'bg-amber-100 text-amber-800 ring-amber-200',
};

export function StatusPill({ status }: Props) {
  return (
    <span
      aria-label={`Status: ${status}`}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ring-1 ${STYLE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
