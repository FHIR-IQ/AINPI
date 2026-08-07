import { ImageResponse } from 'next/og';

/**
 * Shared Open Graph card renderer.
 *
 * Every share of this site previously rendered a bare text card because no
 * og:image existed anywhere. These cards carry the same editorial system as
 * the site: archival paper, the Newsreader display serif, a rule above the
 * masthead. The point is that a link posted to LinkedIn or Slack looks like a
 * published record rather than an untitled link.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const PAPER = '#faf8f5';
const INK = '#171310';
const MUTED = '#6b6459';
const RULE = '#ddd7cc';
const ACCENT = '#08519c';

// Memoised across cards. Every finding generates its own image at build time,
// so without this the build would refetch the same font file 30-odd times.
let fontCache: Promise<
  { name: string; data: ArrayBuffer; weight: 400 | 600; style: 'normal' }[] | undefined
> | null = null;

/** Fetch the display serif. Falls back to the default face if unavailable,
 *  because a font CDN hiccup must not fail a build. */
async function displayFont(): Promise<
  { name: string; data: ArrayBuffer; weight: 400 | 600; style: 'normal' }[] | undefined
> {
  try {
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Newsreader:wght@600&display=swap',
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    ).then((r) => r.text());
    const url = css.match(/src:\s*url\((https:[^)]+\.(?:ttf|woff2?))\)/)?.[1];
    if (!url) return undefined;
    const data = await fetch(url).then((r) => r.arrayBuffer());
    return [{ name: 'Newsreader', data, weight: 600, style: 'normal' }];
  } catch {
    return undefined;
  }
}

export async function renderOgCard({
  eyebrow,
  title,
  stats,
}: {
  eyebrow?: string;
  title: string;
  /** Up to three figures, rendered like a statistical table rather than badges. */
  stats?: { value: string; label: string }[];
}) {
  const fonts = await (fontCache ??= displayFont());
  const serif = fonts ? 'Newsreader' : 'serif';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: PAPER,
          padding: '64px 72px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {eyebrow ? (
            <div
              style={{
                fontSize: 21,
                letterSpacing: 3.4,
                textTransform: 'uppercase',
                color: MUTED,
                marginBottom: 26,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: serif,
              fontSize: title.length > 92 ? 60 : title.length > 58 ? 70 : 82,
              lineHeight: 1.06,
              letterSpacing: -1.8,
              color: INK,
              maxWidth: 1010,
            }}
          >
            {title}
          </div>
        </div>

        {stats && stats.length > 0 ? (
          <div style={{ display: 'flex', gap: 56 }}>
            {stats.slice(0, 3).map((s) => (
              <div
                key={s.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderTop: `2px solid ${RULE}`,
                  paddingTop: 12,
                  minWidth: 230,
                }}
              >
                <div style={{ fontSize: 46, color: INK, letterSpacing: -1 }}>{s.value}</div>
                <div
                  style={{
                    fontSize: 18,
                    color: MUTED,
                    textTransform: 'uppercase',
                    letterSpacing: 2,
                    marginTop: 6,
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderTop: `2px solid ${RULE}`,
            paddingTop: 22,
          }}
        >
          <div style={{ fontFamily: serif, fontSize: 36, color: INK, letterSpacing: -0.6 }}>
            AINPI
          </div>
          <div
            style={{
              fontSize: 19,
              color: MUTED,
              textTransform: 'uppercase',
              letterSpacing: 2.6,
              marginLeft: 16,
              paddingLeft: 16,
              borderLeft: `2px solid ${RULE}`,
            }}
          >
            Provider data audit
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 19, color: ACCENT }}>ainpi.dev</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
