'use client';

import { useState } from 'react';
import { Share2, Link as LinkIcon, Check } from 'lucide-react';

interface ShareButtonsProps {
  url?: string;
  title?: string;
  /** Compact rendering (just icons) for tight layouts like the hero. */
  compact?: boolean;
  /** Light variant for dark-gradient backgrounds. */
  variant?: 'light' | 'dark';
}

const TWITTER_INTENT = 'https://twitter.com/intent/tweet';
const LINKEDIN_INTENT = 'https://www.linkedin.com/sharing/share-offsite/';

export default function ShareButtons({
  url = 'https://ainpi.vercel.app',
  title = 'AINPI — open-source audit of the CMS National Provider Directory',
  compact = false,
  variant = 'light',
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // browsers without clipboard support — no-op
    }
  }

  async function nativeShare() {
    const nav = navigator as unknown as {
      share?: (data: { url: string; title: string; text?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ url, title });
      } catch {
        // user cancelled, fine
      }
    } else {
      copyLink();
    }
  }

  const hasNativeShare =
    typeof navigator !== 'undefined' &&
    typeof (navigator as unknown as { share?: unknown }).share === 'function';

  const btnBase = compact
    ? 'inline-flex items-center justify-center rounded-md p-2 transition'
    : 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition';

  const btnVariant =
    variant === 'dark'
      ? 'bg-white/10 hover:bg-white/20 text-white'
      : 'bg-gray-100 hover:bg-gray-200 text-gray-700';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasNativeShare && (
        <button
          type="button"
          onClick={nativeShare}
          className={`${btnBase} ${btnVariant}`}
          aria-label="Share"
        >
          <Share2 className="w-4 h-4" />
          {!compact && <span>Share</span>}
        </button>
      )}
      <a
        href={`${TWITTER_INTENT}?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
        target="_blank"
        rel="noopener"
        className={`${btnBase} ${btnVariant}`}
        aria-label="Share on X (Twitter)"
      >
        <span className="font-bold text-base leading-none">𝕏</span>
        {!compact && <span>Post</span>}
      </a>
      <a
        href={`${LINKEDIN_INTENT}?url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener"
        className={`${btnBase} ${btnVariant}`}
        aria-label="Share on LinkedIn"
      >
        <span className="font-bold text-xs leading-none">in</span>
        {!compact && <span>LinkedIn</span>}
      </a>
      <button
        type="button"
        onClick={copyLink}
        className={`${btnBase} ${btnVariant}`}
        aria-label="Copy link"
      >
        {copied ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
        {!compact && <span>{copied ? 'Copied' : 'Copy link'}</span>}
      </button>
    </div>
  );
}
