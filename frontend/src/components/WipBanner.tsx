'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ainpi-wip-dismissed';

export default function WipBanner() {
  const [dismissed, setDismissed] = useState(true); // start true to avoid SSR flicker

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  if (dismissed) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <p className="text-xs sm:text-sm text-amber-900 flex-1">
          <strong>Work in progress.</strong> AINPI is an experimental exploration of the CMS National Provider Directory
          (2026-04-09 release). Data may be incomplete, stale, or incorrect — numbers should be independently verified
          before any business or clinical decision.{' '}
          <a href="/insights" className="underline font-medium hover:text-amber-700">See provenance analysis →</a>
        </p>
        <button
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, '1');
            setDismissed(true);
          }}
          className="text-amber-700 hover:text-amber-900 flex-shrink-0"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
