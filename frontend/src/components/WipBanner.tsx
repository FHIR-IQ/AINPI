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
    <div className="bg-gray-100 border-b border-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3">
        <AlertTriangle className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        <p className="text-xs text-gray-600 flex-1">
          <strong>Work in progress.</strong> AINPI is an experimental exploration of the CMS National Provider Directory
          (2026-05-08 release). Data may be incomplete, stale, or incorrect: numbers should be independently verified
          before any business or clinical decision.{' '}
          <a href="/insights" className="underline font-medium text-gray-800 hover:text-primary-600">See provenance analysis →</a>
        </p>
        <button
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, '1');
            setDismissed(true);
          }}
          className="text-gray-500 hover:text-ink flex-shrink-0"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
