import { AUTHOR } from '@/data/author';

interface AuthorBylineProps {
  /** Optional override for the credentials line on a per-page basis. */
  credentials?: string;
  /** Whether to show 'Last reviewed' date next to the byline. */
  lastReviewed?: string;
  /** Tone — 'analyst' (light gray border, dense) or 'card' (white card, padded). */
  variant?: 'analyst' | 'card';
}

export default function AuthorByline({
  credentials,
  lastReviewed,
  variant = 'analyst',
}: AuthorBylineProps) {
  const cred = credentials ?? AUTHOR.credentialsLine;

  if (variant === 'card') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm">
        <p className="font-medium text-gray-900">{AUTHOR.name}</p>
        <p className="text-gray-600">{cred}</p>
        <p className="mt-2 space-x-3 text-gray-500">
          <a
            href={AUTHOR.links.bio}
            target="_blank"
            rel="noopener"
            className="underline hover:text-primary-600"
          >
            Bio
          </a>
          <a
            href={AUTHOR.links.linkedin}
            target="_blank"
            rel="noopener"
            className="underline hover:text-primary-600"
          >
            LinkedIn
          </a>
          <a
            href={`mailto:${AUTHOR.links.email}`}
            className="underline hover:text-primary-600"
          >
            {AUTHOR.links.email}
          </a>
        </p>
        {lastReviewed && (
          <p className="mt-2 text-xs text-gray-500">Last reviewed {lastReviewed}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border-l-2 border-gray-200 pl-4 py-1 text-sm">
      <p>
        <span className="font-medium text-gray-900">{AUTHOR.name}</span>
        <span className="text-gray-600"> — {cred}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500 space-x-3">
        <a
          href={AUTHOR.links.bio}
          target="_blank"
          rel="noopener"
          className="underline hover:text-primary-600"
        >
          Bio
        </a>
        <a
          href={AUTHOR.links.linkedin}
          target="_blank"
          rel="noopener"
          className="underline hover:text-primary-600"
        >
          LinkedIn
        </a>
        <a
          href={`mailto:${AUTHOR.links.email}`}
          className="underline hover:text-primary-600"
        >
          {AUTHOR.links.email}
        </a>
        {lastReviewed && (
          <span className="text-gray-400">· Last reviewed {lastReviewed}</span>
        )}
      </p>
    </div>
  );
}
