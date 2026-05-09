/**
 * ReleaseTeaser — dark, data-forward hero for a specific NDH release update.
 * Visual language adapted from the AINPI Update Video design (Claude Design,
 * 2026-05-08): Inter Tight headline, JetBrains Mono labels, accent / loss /
 * gain triad, hairline dividers, scanline-flavored dot grid backdrop.
 *
 * Static — no animation. The animated variant lives at
 * /video/2026-05-08-update/ and links from the "Watch the update" CTA.
 */
import Link from 'next/link';

interface DeltaStat {
  label: string;
  delta: string;
  /** 'loss' (red) | 'gain' (green) | undefined (neutral) */
  tone?: 'loss' | 'gain';
}

interface ReleaseTeaserProps {
  eyebrow: string;
  /** Two-line headline. Second line gets the accent color. */
  headlineA: string;
  headlineB: string;
  caption: string;
  stats: DeltaStat[];
  /** Where the "Watch the update" CTA goes. */
  videoHref?: string;
  reportSlug: string;
  releaseDate: string;
  methodologyVersion?: string;
}

const ACCENT = '#5b9dff';
const LOSS = '#ff5d6c';
const GAIN = '#4ade80';

export default function ReleaseTeaser({
  eyebrow,
  headlineA,
  headlineB,
  caption,
  stats,
  videoHref,
  reportSlug,
  releaseDate,
  methodologyVersion = '0.6.0-draft',
}: ReleaseTeaserProps) {
  return (
    <section
      aria-label="Release update teaser"
      className="relative overflow-hidden text-white"
      style={{
        background: '#06080d',
        fontFamily:
          "'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* dot grid */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 0)',
          backgroundSize: '32px 32px',
          maskImage:
            'radial-gradient(ellipse 80% 90% at 50% 50%, #000 40%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 90% at 50% 50%, #000 40%, transparent 100%)',
        }}
      />
      {/* accent glow */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          left: '50%',
          top: '50%',
          width: '140%',
          height: '140%',
          marginLeft: '-70%',
          marginTop: '-70%',
          background: `radial-gradient(circle, ${ACCENT}1f 0%, transparent 55%)`,
          opacity: 0.6,
        }}
      />
      {/* vignette */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 100% 70% at 50% 50%, transparent 50%, rgba(0,0,0,0.5))',
        }}
      />

      <div className="relative max-w-5xl mx-auto px-6 sm:px-10 py-14 sm:py-20">
        {/* header rail */}
        <div
          className="flex items-center justify-between text-xs sm:text-sm tracking-wider mb-12"
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{
                background: ACCENT,
                boxShadow: `0 0 12px ${ACCENT}`,
              }}
            />
            <span className="text-white font-semibold">AINPI</span>
            <span className="opacity-40">·</span>
            <span>ainpi.dev</span>
          </div>
          <div className="flex items-center gap-3">
            <span>NDH</span>
            <span className="opacity-40">·</span>
            <span>{releaseDate}</span>
          </div>
        </div>

        {/* eyebrow */}
        <div
          className="text-xs sm:text-sm uppercase mb-6"
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
            color: ACCENT,
            letterSpacing: '0.18em',
          }}
        >
          {eyebrow}
        </div>

        {/* headline */}
        <h1
          className="text-5xl sm:text-7xl lg:text-8xl font-bold leading-none tracking-tight mb-8"
          style={{ letterSpacing: '-0.04em' }}
        >
          <span className="block">{headlineA}</span>
          <span className="block" style={{ color: ACCENT }}>
            {headlineB}
          </span>
        </h1>

        {/* hairline */}
        <div
          aria-hidden
          className="mb-10"
          style={{
            width: '70%',
            height: 2,
            background: 'rgba(255,255,255,0.32)',
          }}
        />

        {/* stat row */}
        <div
          className="flex flex-wrap items-stretch gap-x-8 gap-y-6 mb-10"
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
          }}
        >
          {stats.map((s, i) => (
            <div key={s.label} className="flex items-stretch gap-x-8">
              <div className="flex flex-col gap-2">
                <div
                  className="text-[11px] sm:text-xs uppercase"
                  style={{
                    color: 'rgba(255,255,255,0.5)',
                    letterSpacing: '0.12em',
                  }}
                >
                  {s.label}
                </div>
                <div
                  className="text-3xl sm:text-5xl font-semibold tabular-nums"
                  style={{
                    color:
                      s.tone === 'loss'
                        ? LOSS
                        : s.tone === 'gain'
                          ? GAIN
                          : '#fff',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {s.delta}
                </div>
              </div>
              {i < stats.length - 1 && (
                <div
                  aria-hidden
                  className="self-stretch hidden sm:block w-px"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* caption */}
        <p
          className="text-sm sm:text-base leading-relaxed max-w-2xl mb-10"
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
            color: 'rgba(255,255,255,0.62)',
          }}
        >
          {caption}
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap gap-3">
          {videoHref && (
            <a
              href={videoHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-md transition-colors"
              style={{
                background: ACCENT,
                color: '#06080d',
              }}
            >
              <svg
                aria-hidden
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <path d="M3 1.5v11l9-5.5-9-5.5z" fill="currentColor" />
              </svg>
              Watch the 48-second update
            </a>
          )}
          <Link
            href={`/reports/${reportSlug}`}
            className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
            }}
          >
            Read the full report →
          </Link>
        </div>

        {/* footer rail */}
        <div
          className="mt-16 flex items-center justify-between text-[11px] uppercase pt-8"
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.06em',
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span>methodology v{methodologyVersion}</span>
          <span>NDH {releaseDate}</span>
        </div>
      </div>
    </section>
  );
}
