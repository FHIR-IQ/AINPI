'use client';

interface PrintButtonProps {
  label?: string;
  className?: string;
}

/**
 * Standalone client-side print trigger.
 *
 * Extracted so the parent page can stay a Server Component (required for
 * fs-based data loading via loadFinding / loadStats at build time).
 */
export default function PrintButton({
  label = 'Save as PDF',
  className = 'px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors',
}: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={className}
    >
      {label}
    </button>
  );
}
