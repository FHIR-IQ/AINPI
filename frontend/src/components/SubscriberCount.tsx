'use client';

import { useEffect, useState } from 'react';

/**
 * SubscriberCount — fetches `/api/v1/subscribers/count` once on mount
 * and renders "Join N readers" or a fallback. Cosmetic only; if the
 * count is unavailable (Supabase down, table missing in fresh deploy)
 * the component renders a neutral fallback.
 *
 * Two shapes:
 *   - default: "Join 123 readers" (linkable to /subscribe)
 *   - inline:  just the number, no chrome (for hero / nav placement)
 */
export default function SubscriberCount({
  variant = 'default',
  className = '',
}: {
  variant?: 'default' | 'inline';
  className?: string;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/subscribers/count')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.count === 'number') setCount(data.count);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (variant === 'inline') {
    if (!loaded) {
      return <span className={className} aria-hidden="true">…</span>;
    }
    if (count === null || count === 0) {
      return null;
    }
    return (
      <span className={className} title={`${count} subscribers`}>
        {count.toLocaleString()}
      </span>
    );
  }

  // default variant: "Join N readers"
  if (!loaded) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm text-gray-500 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" aria-hidden="true" />
        Loading subscribers…
      </span>
    );
  }
  if (count === null) {
    return null; // service unavailable; render nothing
  }
  return (
    <a
      href="/subscribe"
      className={`inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Join <strong className="text-gray-900">{count.toLocaleString()}</strong> readers
    </a>
  );
}
