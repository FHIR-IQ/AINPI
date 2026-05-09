// scenes.jsx — AINPI 2026-05-08 viral update video scenes
// All scene components for the Stage. Each scene is wrapped in <Sprite> with
// timing baked in. Read theme/typography off CSS variables on :root so the
// Tweaks panel can re-skin without React re-renders.

const MONO = "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";
const SANS = "'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif";
const SERIF = "'Instrument Serif', 'Times New Roman', Georgia, serif";

// ── Shared atoms ────────────────────────────────────────────────────────────

function Backdrop({ width, height, accent }) {
  // Grid + subtle scan lines + vignette. Static — read-only background.
  const t = useTime();
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'var(--bg, #06080d)',
      overflow: 'hidden',
    }}>
      {/* dot grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 0)`,
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(ellipse 80% 90% at 50% 50%, #000 40%, transparent 100%)',
      }}/>
      {/* accent glow */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%', width: width * 1.4, height: width * 1.4,
        marginLeft: -(width * 0.7), marginTop: -(width * 0.7),
        background: `radial-gradient(circle, ${accent}1f 0%, transparent 55%)`,
        opacity: 0.6,
      }}/>
      {/* scanline */}
      <div style={{
        position: 'absolute', left: 0, right: 0,
        top: ((t * 80) % (height + 200)) - 100,
        height: 200,
        background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.02) 50%, transparent)',
        pointerEvents: 'none',
      }}/>
      {/* vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 100% 70% at 50% 50%, transparent 50%, rgba(0,0,0,0.5))',
        pointerEvents: 'none',
      }}/>
    </div>
  );
}

// Persistent header with logo + release tag — visible during all scenes
function HeaderRail({ width }) {
  const t = useTime();
  const blink = Math.floor(t * 2) % 2 === 0;
  return (
    <div style={{
      position: 'absolute',
      left: 48, right: 48, top: 56,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: MONO, fontSize: 22, color: 'rgba(255,255,255,0.6)',
      letterSpacing: '0.04em',
      zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 14, height: 14, borderRadius: 7,
          background: blink ? 'var(--accent, #5b9dff)' : 'transparent',
          border: '2px solid var(--accent, #5b9dff)',
          boxShadow: blink ? '0 0 16px var(--accent, #5b9dff)' : 'none',
          transition: 'all 100ms',
        }}/>
        <span style={{ color: '#fff', fontWeight: 600 }}>AINPI</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>ainpi.dev</span>
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        <span>NDH</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>2026-05-08</span>
      </div>
    </div>
  );
}

function FooterRail({ width, height, currentScene, totalScenes }) {
  const t = useTime();
  return (
    <div style={{
      position: 'absolute',
      left: 48, right: 48, bottom: 56,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: MONO, fontSize: 18, color: 'rgba(255,255,255,0.4)',
      letterSpacing: '0.06em', textTransform: 'uppercase',
      zIndex: 50,
    }}>
      <span>methodology v0.6.0-draft</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {String(currentScene).padStart(2, '0')} / {String(totalScenes).padStart(2, '0')}
      </span>
    </div>
  );
}

// SceneIndex — invisible helper that figures out which scene number to display
function useSceneIndex(boundaries) {
  const t = useTime();
  for (let i = 0; i < boundaries.length; i++) {
    if (t < boundaries[i]) return i + 1;
  }
  return boundaries.length;
}

// ── Scene 01 · Title ────────────────────────────────────────────────────────

function SceneTitle({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        const opener = Easing.easeOutCubic(clamp(localTime / 0.6, 0, 1));
        const slide = Easing.easeOutExpo(clamp((localTime - 0.3) / 0.9, 0, 1));
        const lineGrow = Easing.easeOutExpo(clamp((localTime - 0.6) / 1.1, 0, 1));
        const subA = clamp((localTime - 1.4) / 0.5, 0, 1);
        const subB = clamp((localTime - 1.8) / 0.5, 0, 1);
        const exit = Easing.easeInCubic(clamp((localTime - (duration - 0.5)) / 0.5, 0, 1));
        const exitOp = 1 - exit;

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'flex-start',
            padding: '0 96px',
            opacity: exitOp,
          }}>
            {/* Eyebrow */}
            <div style={{
              fontFamily: MONO, fontSize: 28, letterSpacing: '0.18em',
              color: 'var(--accent, #5b9dff)', textTransform: 'uppercase',
              opacity: opener, transform: `translateY(${(1-opener)*20}px)`,
              marginBottom: 32,
            }}>
              Release update · Δ April → May
            </div>

            {/* Headline */}
            <div style={{
              fontFamily: SANS, fontWeight: 700,
              fontSize: 168, lineHeight: 0.92,
              color: '#fff', letterSpacing: '-0.04em',
              opacity: opener,
              transform: `translateY(${(1-slide)*40}px)`,
            }}>
              <div>The shape</div>
              <div style={{ color: 'var(--accent, #5b9dff)' }}>changed.</div>
            </div>

            {/* Hairline divider */}
            <div style={{
              marginTop: 48, marginBottom: 36,
              width: `${lineGrow * 70}%`,
              height: 2, background: 'rgba(255,255,255,0.4)',
            }}/>

            {/* Sub-stats row */}
            <div style={{
              display: 'flex', gap: 48,
              fontFamily: MONO, color: '#fff',
              opacity: subA,
            }}>
              <Stat label="Endpoint" delta="−73%" tone="loss" />
              <div style={{ width: 1, background: 'rgba(255,255,255,0.15)' }}/>
              <Stat label="Location" delta="−61%" tone="loss" />
              <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', opacity: subB }}/>
              <div style={{ opacity: subB }}>
                <Stat label="OrgAffil" delta="+147%" tone="gain" />
              </div>
            </div>

            {/* Caption */}
            <div style={{
              marginTop: 80,
              fontFamily: MONO, fontSize: 22,
              color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.02em',
              opacity: subB, maxWidth: 820, lineHeight: 1.5,
            }}>
              CMS pushed a new bulk export. AINPI re-ingested<br/>
              every resource and re-ran every H-series check.
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

function Stat({ label, delta, tone }) {
  const color = tone === 'loss' ? 'var(--loss, #ff5d6c)'
              : tone === 'gain' ? 'var(--gain, #4ade80)'
              : '#fff';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontSize: 18, letterSpacing: '0.12em',
        color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontSize: 60, fontWeight: 600, color,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
      }}>{delta}</div>
    </div>
  );
}

// ── Scene 02 · Big number reveal: −73% Endpoints ────────────────────────────

function SceneBigNumber({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        // Counter from 5,043,524 → 1,360,585
        const APRIL = 5043524;
        const MAY = 1360585;
        const counterT = Easing.easeOutExpo(clamp((localTime - 0.5) / 1.6, 0, 1));
        const current = Math.round(APRIL + (MAY - APRIL) * counterT);
        const op = clamp(localTime / 0.4, 0, 1);
        const exit = clamp((localTime - (duration - 0.4)) / 0.4, 0, 1);
        const opacity = (1 - exit) * op;

        const pctReveal = Easing.easeOutBack(clamp((localTime - 1.6) / 0.7, 0, 1));
        const labelReveal = clamp((localTime - 2.0) / 0.4, 0, 1);

        // Bar fill animation
        const aprilBar = Easing.easeOutCubic(clamp((localTime - 0.4) / 0.7, 0, 1));
        const mayBar = Easing.easeOutCubic(clamp((localTime - 1.0) / 1.4, 0, 1));
        const aprilWidth = 800 * aprilBar;
        const mayWidth = 800 * mayBar * (MAY / APRIL);

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'flex-start',
            padding: '0 96px',
            opacity,
          }}>
            <div style={{
              fontFamily: MONO, fontSize: 26, letterSpacing: '0.18em',
              color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase',
              marginBottom: 56,
            }}>
              FHIR Resource · Endpoint
            </div>

            {/* April bar */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: MONO, fontSize: 22, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                APRIL · 5,043,524
              </div>
              <div style={{
                width: aprilWidth, height: 32,
                background: 'rgba(255,255,255,0.85)',
                borderRadius: 0,
              }}/>
            </div>

            {/* May bar */}
            <div style={{ marginBottom: 56 }}>
              <div style={{ fontFamily: MONO, fontSize: 22, color: 'var(--loss, #ff5d6c)', marginBottom: 12 }}>
                MAY &nbsp;· {current.toLocaleString()}
              </div>
              <div style={{
                width: mayWidth, height: 32,
                background: 'var(--loss, #ff5d6c)',
                boxShadow: '0 0 32px rgba(255,93,108,0.5)',
              }}/>
            </div>

            {/* Big delta */}
            <div style={{
              fontFamily: SANS, fontWeight: 700,
              fontSize: 360, lineHeight: 0.85,
              color: 'var(--loss, #ff5d6c)',
              letterSpacing: '-0.05em',
              transform: `scale(${pctReveal})`,
              transformOrigin: 'left center',
              opacity: pctReveal,
            }}>
              −73%
            </div>

            {/* Caption */}
            <div style={{
              marginTop: 24,
              fontFamily: MONO, fontSize: 26,
              color: 'rgba(255,255,255,0.7)',
              opacity: labelReveal,
              maxWidth: 880, lineHeight: 1.45,
            }}>
              CMS appears to have de-duplicated<br/>
              multi-address Endpoints between releases.
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

// ── Scene 03 · Resource count table ─────────────────────────────────────────

const RESOURCES = [
  { name: 'Practitioner',          april: 7441213, may: 7441211, delta: 'flat', pct: 0 },
  { name: 'Organization',          april: 3603262, may: 3414375, delta: '−5.2%', pct: -5.2 },
  { name: 'Location',              april: 3494239, may: 1362869, delta: '−61%', pct: -61 },
  { name: 'Endpoint',              april: 5043524, may: 1360585, delta: '−73%', pct: -73 },
  { name: 'PractitionerRole',      april: 7178732, may: 7028001, delta: '−2.1%', pct: -2.1 },
  { name: 'OrganizationAffiliation', april: 439599, may: 1086694, delta: '+147%', pct: 147 },
];

function SceneTable({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        const op = clamp(localTime / 0.4, 0, 1);
        const exit = clamp((localTime - (duration - 0.4)) / 0.4, 0, 1);
        const opacity = (1 - exit) * op;

        const headOp = clamp(localTime / 0.5, 0, 1);
        const totalReveal = clamp((localTime - 6) / 0.6, 0, 1);

        // Max for bar scaling — use April max
        const maxVal = Math.max(...RESOURCES.map(r => Math.max(r.april, r.may)));

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            padding: '220px 96px 200px',
            opacity,
          }}>
            <div style={{
              fontFamily: MONO, fontSize: 26, letterSpacing: '0.18em',
              color: 'var(--accent, #5b9dff)', textTransform: 'uppercase',
              marginBottom: 16,
              opacity: headOp,
            }}>
              FHIR Resources · April vs May
            </div>
            <div style={{
              fontFamily: SANS, fontSize: 76, fontWeight: 700,
              color: '#fff', letterSpacing: '-0.03em', marginBottom: 56,
              opacity: headOp, lineHeight: 1,
            }}>
              27.2M&nbsp;<span style={{ color: 'rgba(255,255,255,0.4)' }}>→</span>&nbsp;<span style={{ color: 'var(--loss, #ff5d6c)' }}>21.7M</span>
            </div>

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {RESOURCES.map((r, i) => {
                const rowStart = 0.6 + i * 0.55;
                const rowOp = Easing.easeOutCubic(clamp((localTime - rowStart) / 0.5, 0, 1));
                const barT = Easing.easeOutExpo(clamp((localTime - rowStart - 0.15) / 0.7, 0, 1));
                const aprilW = (r.april / maxVal) * 100 * barT;
                const mayW = (r.may / maxVal) * 100 * barT;
                const tone = r.pct < -10 ? 'loss' : r.pct > 50 ? 'gain' : 'neutral';
                const deltaColor = tone === 'loss' ? 'var(--loss)'
                                  : tone === 'gain' ? 'var(--gain)'
                                  : 'rgba(255,255,255,0.55)';

                return (
                  <div key={r.name} style={{
                    display: 'grid',
                    gridTemplateColumns: '320px 1fr 180px',
                    alignItems: 'center', gap: 24,
                    opacity: rowOp,
                    transform: `translateX(${(1-rowOp)*-20}px)`,
                  }}>
                    {/* label */}
                    <div style={{
                      fontFamily: MONO, fontSize: 22,
                      color: '#fff', fontWeight: 500,
                      letterSpacing: '0.01em',
                    }}>{r.name}</div>

                    {/* twin bar */}
                    <div style={{ position: 'relative', height: 36 }}>
                      <div style={{
                        position: 'absolute', top: 0, left: 0,
                        width: `${aprilW}%`, height: 16,
                        background: 'rgba(255,255,255,0.22)',
                      }}/>
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0,
                        width: `${mayW}%`, height: 16,
                        background: tone === 'gain' ? 'var(--gain, #4ade80)'
                                  : tone === 'loss' ? 'var(--loss, #ff5d6c)'
                                  : 'rgba(255,255,255,0.6)',
                      }}/>
                    </div>

                    {/* delta */}
                    <div style={{
                      fontFamily: MONO, fontSize: 30, fontWeight: 600,
                      color: deltaColor, fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right', letterSpacing: '-0.01em',
                    }}>{r.delta}</div>
                  </div>
                );
              })}
            </div>

            {/* Total callout */}
            <div style={{
              marginTop: 56, paddingTop: 32,
              borderTop: '1px solid rgba(255,255,255,0.12)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              opacity: totalReveal,
            }}>
              <div style={{ fontFamily: MONO, fontSize: 26, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.04em' }}>
                TOTAL RESOURCES
              </div>
              <div style={{
                fontFamily: SANS, fontSize: 64, fontWeight: 700,
                color: 'var(--loss, #ff5d6c)', letterSpacing: '-0.02em',
              }}>−20.2%</div>
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

// ── Scene 04 · Schema break alert ───────────────────────────────────────────

function SceneSchemaBreak({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        const op = clamp(localTime / 0.3, 0, 1);
        const exit = clamp((localTime - (duration - 0.4)) / 0.4, 0, 1);
        const opacity = (1 - exit) * op;

        const flashCount = Math.floor(localTime * 4);
        const flash = localTime < 0.6 && flashCount % 2 === 0;

        const head = Easing.easeOutCubic(clamp((localTime - 0.3) / 0.5, 0, 1));
        const b1 = Easing.easeOutCubic(clamp((localTime - 1.2) / 0.6, 0, 1));
        const b2 = Easing.easeOutCubic(clamp((localTime - 3.0) / 0.6, 0, 1));

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 96px',
            opacity,
          }}>
            {/* Alert banner */}
            <div style={{
              display: 'inline-flex', alignSelf: 'flex-start',
              alignItems: 'center', gap: 16,
              padding: '14px 24px',
              background: flash ? 'var(--loss, #ff5d6c)' : 'transparent',
              border: '2px solid var(--loss, #ff5d6c)',
              fontFamily: MONO, fontSize: 22, letterSpacing: '0.18em',
              color: flash ? '#06080d' : 'var(--loss, #ff5d6c)',
              fontWeight: 700, textTransform: 'uppercase',
              marginBottom: 40,
            }}>
              <span>◆</span> Consumer Alert · Silent Schema Breaks
            </div>

            <div style={{
              fontFamily: SANS, fontWeight: 700,
              fontSize: 124, lineHeight: 0.95,
              color: '#fff', letterSpacing: '-0.04em',
              marginBottom: 64,
              opacity: head,
            }}>
              Two breaks <br/>
              <span style={{ color: 'var(--accent)' }}>nobody </span>
              <span style={{ color: 'var(--accent)', textDecoration: 'line-through', textDecorationColor: 'var(--loss, #ff5d6c)', textDecorationThickness: 6 }}>noticed</span>
              <span style={{ color: 'var(--accent)' }}>.</span>
            </div>

            {/* Break 1 */}
            <BreakCard
              n="01"
              title="NPI identifier system URL changed"
              before="http://hl7.org/fhir/sid/us-npi"
              after="http://terminology.hl7.org/NamingSystem/npi"
              consequence="Consumers string-matching the old URL just lost 7.4M practitioner NPIs — without throwing an error."
              opacity={b1}
            />
            <div style={{ height: 28 }}/>
            {/* Break 2 */}
            <BreakCard
              n="02"
              title="PractitionerRole.specialty codes shifted"
              before="14-50  (CMS Medicare format)"
              after="207R00000X  (NUCC taxonomy)"
              consequence="Joins to the CMS Medicare crosswalk now look invalid — even though codes are valid NUCC."
              opacity={b2}
            />
          </div>
        );
      }}
    </Sprite>
  );
}

function BreakCard({ n, title, before, after, consequence, opacity }) {
  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(255,255,255,0.025)',
      padding: '28px 36px',
      opacity,
      transform: `translateY(${(1-opacity)*16}px)`,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 24,
      }}>
        <span style={{
          fontFamily: MONO, fontSize: 24, color: 'var(--accent)',
          letterSpacing: '0.1em', fontWeight: 700,
        }}>BREAK / {n}</span>
        <span style={{
          fontFamily: SANS, fontSize: 36, fontWeight: 600, color: '#fff',
          letterSpacing: '-0.02em',
        }}>{title}</span>
      </div>
      <div style={{
        fontFamily: MONO, fontSize: 22, color: 'rgba(255,255,255,0.6)',
        display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4,
      }}>
        <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>was </span>
          <s style={{ color: 'rgba(255,255,255,0.5)', textDecorationThickness: 1 }}>{before}</s></div>
        <div><span style={{ color: 'var(--gain, #4ade80)' }}>now </span>
          <span style={{ color: '#fff' }}>{after}</span></div>
      </div>
      <div style={{
        fontFamily: SANS, fontSize: 22, color: 'var(--loss, #ff5d6c)',
        lineHeight: 1.4, fontWeight: 500,
      }}>
        ⚠ {consequence}
      </div>
    </div>
  );
}

// ── Scene 05 · SSN exposures with US map ────────────────────────────────────

function SceneSSN({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        const op = clamp(localTime / 0.4, 0, 1);
        const exit = clamp((localTime - (duration - 0.4)) / 0.4, 0, 1);
        const opacity = (1 - exit) * op;

        const head = Easing.easeOutCubic(clamp((localTime - 0.2) / 0.5, 0, 1));
        const fromN = clamp((localTime - 0.8) / 0.4, 0, 1);
        const toN = Easing.easeOutExpo(clamp((localTime - 1.6) / 1.0, 0, 1));
        const fromCount = 46;
        const toCount = 41;
        const current = Math.round(fromCount + (toCount - fromCount) * toN);
        const mapOp = clamp((localTime - 2.5) / 0.6, 0, 1);
        const ilOp = clamp((localTime - 3.4) / 0.5, 0, 1);
        const captionOp = clamp((localTime - 4.4) / 0.5, 0, 1);

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            padding: '220px 96px 200px',
            opacity,
          }}>
            <div style={{
              fontFamily: MONO, fontSize: 26, letterSpacing: '0.18em',
              color: 'var(--accent)', textTransform: 'uppercase',
              opacity: head, marginBottom: 18,
            }}>
              Confirmed SSN exposures
            </div>
            <div style={{
              fontFamily: SANS, fontSize: 84, fontWeight: 700,
              color: '#fff', letterSpacing: '-0.03em', lineHeight: 1,
              opacity: head, marginBottom: 48,
            }}>
              CMS partially scrubbed.<br/>
              <span style={{ color: 'var(--gain)' }}>The leak is real.</span>
            </div>

            {/* Counter row */}
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 36,
              fontFamily: SANS, fontWeight: 700,
              letterSpacing: '-0.04em',
              marginBottom: 80,
            }}>
              <div style={{ opacity: fromN, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: MONO, fontSize: 20, color: 'rgba(255,255,255,0.5)', fontWeight: 400, letterSpacing: '0.18em', marginBottom: 8 }}>APRIL</div>
                <div style={{ fontSize: 220, color: 'rgba(255,255,255,0.32)', textDecoration: 'line-through', textDecorationThickness: 8 }}>46</div>
              </div>
              <div style={{ fontSize: 140, color: 'rgba(255,255,255,0.45)', opacity: toN }}>→</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: MONO, fontSize: 20, color: 'var(--gain)', fontWeight: 400, letterSpacing: '0.18em', marginBottom: 8 }}>MAY</div>
                <div style={{
                  fontSize: 280, color: 'var(--gain, #4ade80)',
                  fontVariantNumeric: 'tabular-nums',
                  textShadow: '0 0 60px rgba(74,222,128,0.4)',
                }}>{current}</div>
              </div>
            </div>

            {/* IL callout map */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 48,
              opacity: mapOp,
            }}>
              <div style={{ flex: '0 0 auto' }}>
                <USMap highlight="IL" highlightOp={ilOp} width={420} height={260} />
              </div>
              <div style={{ flex: 1, opacity: captionOp }}>
                <div style={{
                  fontFamily: MONO, fontSize: 22, color: 'rgba(255,255,255,0.55)',
                  letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12,
                }}>Illinois still leads</div>
                <div style={{
                  fontFamily: SANS, fontSize: 88, fontWeight: 700,
                  color: '#fff', letterSpacing: '-0.04em', lineHeight: 1,
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through' }}>18</span>&nbsp;
                  <span style={{ color: 'var(--accent)' }}>→</span>&nbsp;
                  <span style={{ color: 'var(--loss)' }}>13</span>
                </div>
                <div style={{
                  fontFamily: MONO, fontSize: 22, color: 'rgba(255,255,255,0.55)',
                  marginTop: 16, letterSpacing: '0.04em',
                }}>
                  Independent verification of the <br/>
                  WaPo 2026-04-30 story holds.
                </div>
              </div>
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

// Stylized US map — abstract grid of state pills
function USMap({ highlight, highlightOp, width = 420, height = 260 }) {
  // Abstract grid layout — not geographically accurate, just iconic states
  // arranged in roughly the right zones.
  const states = [
    // [code, col, row]
    ['WA',0,0],['MT',1,0],['ND',2,0],['MN',3,0],['WI',4,0],['MI',5,0],['NY',6,0],['VT',7,0],['ME',8,0],
    ['OR',0,1],['ID',1,1],['SD',2,1],['IA',3,1],['IL',4,1],['IN',5,1],['OH',6,1],['PA',7,1],['NJ',8,1],
    ['CA',0,2],['NV',1,2],['WY',2,2],['NE',3,2],['MO',4,2],['KY',5,2],['WV',6,2],['VA',7,2],['MD',8,2],
    ['UT',1,3],['CO',2,3],['KS',3,3],['AR',4,3],['TN',5,3],['NC',6,3],['DC',7,3],
    ['AZ',1,4],['NM',2,4],['OK',3,4],['LA',4,4],['MS',5,4],['AL',6,4],['GA',7,4],['SC',8,3],
    ['HI',0,4],['TX',3,5],['FL',7,5],
    ['AK',0,3],
  ];
  const cell = 42;
  const pad = 4;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${9 * cell} ${6 * cell}`}>
      {states.map(([code, col, row]) => {
        const isIL = code === highlight;
        return (
          <g key={code}>
            <rect
              x={col * cell + pad}
              y={row * cell + pad}
              width={cell - pad * 2}
              height={cell - pad * 2}
              fill={isIL ? 'var(--loss, #ff5d6c)' : 'rgba(255,255,255,0.08)'}
              stroke={isIL ? 'var(--loss, #ff5d6c)' : 'rgba(255,255,255,0.18)'}
              strokeWidth={1}
              opacity={isIL ? highlightOp : 1}
              style={{ filter: isIL ? `drop-shadow(0 0 8px rgba(255,93,108,${highlightOp * 0.8}))` : 'none' }}
            />
            <text
              x={col * cell + cell / 2}
              y={row * cell + cell / 2 + 4}
              textAnchor="middle"
              fontFamily={MONO}
              fontSize={11}
              fontWeight={isIL ? 700 : 500}
              fill={isIL ? '#06080d' : 'rgba(255,255,255,0.45)'}
              opacity={isIL ? highlightOp : 1}
            >{code}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Scene 06 · Virginia briefing ────────────────────────────────────────────

function SceneVirginia({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        const op = clamp(localTime / 0.4, 0, 1);
        const exit = clamp((localTime - (duration - 0.4)) / 0.4, 0, 1);
        const opacity = (1 - exit) * op;

        const headOp = clamp(localTime / 0.5, 0, 1);
        const heroOp = Easing.easeOutCubic(clamp((localTime - 0.6) / 0.6, 0, 1));
        const heroT = Easing.easeOutExpo(clamp((localTime - 0.6) / 1.4, 0, 1));
        const fromVA = 141660;
        const toVA = 130127;
        const currentVA = Math.round(fromVA + (toVA - fromVA) * heroT);

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            padding: '220px 96px 200px',
            opacity,
          }}>
            <div style={{
              fontFamily: MONO, fontSize: 26, letterSpacing: '0.18em',
              color: 'var(--accent)', textTransform: 'uppercase',
              opacity: headOp, marginBottom: 18,
            }}>
              State Briefing · Virginia
            </div>
            <div style={{
              fontFamily: SANS, fontSize: 92, fontWeight: 700,
              color: '#fff', letterSpacing: '-0.03em', lineHeight: 0.95,
              opacity: headOp, marginBottom: 56,
            }}>
              VA practitioners <br/>
              dropped <span style={{ color: 'var(--loss)' }}>−8.1%</span>
            </div>

            {/* Hero counter */}
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 24,
              opacity: heroOp, marginBottom: 64,
            }}>
              <div style={{
                fontFamily: SANS, fontWeight: 700,
                fontSize: 240, color: '#fff',
                fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em',
                lineHeight: 1,
              }}>
                {currentVA.toLocaleString()}
              </div>
              <div style={{
                fontFamily: MONO, fontSize: 22, color: 'rgba(255,255,255,0.55)',
                letterSpacing: '0.04em', paddingBottom: 24,
              }}>
                in NDH<br/>
                <span style={{ color: 'rgba(255,255,255,0.35)' }}>(was 141,660)</span>
              </div>
            </div>

            {/* Mini stats grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: 18,
            }}>
              <VaStat n="01" label="NPPES-deactivated, still listed" before="4,657" after="4,090" delta="−12.2%" tone="gain" delay={1.4} localTime={localTime}/>
              <VaStat n="02" label="Federally-excluded VA NPIs" before="125" after="131" delta="+4.8%" tone="loss" delay={1.7} localTime={localTime}/>
              <VaStat n="03" label="NPPES match rate" before="99.39%" after="99.50%" delta="flat" tone="neutral" delay={2.0} localTime={localTime}/>
              <VaStat n="04" label="Org-NPI duplicate rate" before="42.50%" after="40.80%" delta="−4.0%" tone="gain" delay={2.3} localTime={localTime}/>
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

function VaStat({ n, label, before, after, delta, tone, delay, localTime }) {
  const op = Easing.easeOutCubic(clamp((localTime - delay) / 0.5, 0, 1));
  const color = tone === 'loss' ? 'var(--loss)'
              : tone === 'gain' ? 'var(--gain)'
              : 'rgba(255,255,255,0.5)';
  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.12)',
      padding: '24px 28px',
      background: 'rgba(255,255,255,0.025)',
      display: 'flex', flexDirection: 'column', gap: 8,
      opacity: op,
      transform: `translateY(${(1-op)*16}px)`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: MONO, fontSize: 14, color: 'var(--accent)', letterSpacing: '0.16em', fontWeight: 700 }}>VA-{n}</span>
        <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{delta}</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.01em' }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 18, color: 'rgba(255,255,255,0.5)' }}>
        {before} <span style={{ opacity: 0.4 }}>→</span> <span style={{ color: 'rgba(255,255,255,0.85)' }}>{after}</span>
      </div>
    </div>
  );
}

// ── Scene 07 · CTA ──────────────────────────────────────────────────────────

function SceneCTA({ start, end, width, height }) {
  return (
    <Sprite start={start} end={end}>
      {({ localTime, duration }) => {
        const op = clamp(localTime / 0.4, 0, 1);
        const exit = clamp((localTime - (duration - 0.5)) / 0.5, 0, 1);
        const opacity = (1 - exit) * op;
        const lineGrow = Easing.easeOutExpo(clamp((localTime - 0.4) / 1.0, 0, 1));
        const urlOp = Easing.easeOutBack(clamp((localTime - 0.8) / 0.7, 0, 1));
        const subOp = clamp((localTime - 1.6) / 0.5, 0, 1);
        const tickerOp = clamp((localTime - 2.2) / 0.5, 0, 1);
        const blink = Math.floor(localTime * 2.4) % 2 === 0;

        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
            padding: '0 96px',
            opacity, textAlign: 'center',
          }}>
            <div style={{
              fontFamily: MONO, fontSize: 24, letterSpacing: '0.2em',
              color: 'var(--accent)', textTransform: 'uppercase',
              opacity: clamp(localTime / 0.4, 0, 1),
              marginBottom: 36,
            }}>Read the full 2026-05-08 update</div>

            <div style={{
              width: `${lineGrow * 90}%`,
              height: 1, background: 'rgba(255,255,255,0.18)',
              marginBottom: 56,
            }}/>

            <div style={{
              fontFamily: SANS, fontWeight: 700,
              fontSize: 180, lineHeight: 0.92,
              color: '#fff', letterSpacing: '-0.05em',
              opacity: urlOp, transform: `scale(${urlOp})`,
              marginBottom: 24,
            }}>
              ainpi<span style={{ color: 'var(--accent)' }}>.dev</span>
              <span style={{
                display: 'inline-block', width: 12, height: 144,
                marginLeft: 8, background: blink ? 'var(--accent)' : 'transparent',
                verticalAlign: 'top', marginTop: 24,
              }}/>
            </div>

            <div style={{
              fontFamily: SANS, fontSize: 32, fontWeight: 500,
              color: 'rgba(255,255,255,0.7)', letterSpacing: '-0.01em',
              opacity: subOp, marginBottom: 56, maxWidth: 760, lineHeight: 1.4,
            }}>
              Methodology · Findings · State briefings <br/>
              All findings, every release. Open and reproducible.
            </div>

            {/* Ticker */}
            <div style={{
              opacity: tickerOp,
              fontFamily: MONO, fontSize: 20, letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase',
              display: 'flex', gap: 32, alignItems: 'center',
            }}>
              <span style={{ color: 'var(--gain)' }}>● LIVE</span>
              <span>27.2M → 21.7M</span>
              <span>·</span>
              <span>NDH 2026-05-08</span>
              <span>·</span>
              <span>v0.6.0-draft</span>
            </div>

            <div style={{
              marginTop: 56, opacity: tickerOp,
              fontFamily: MONO, fontSize: 18, color: 'rgba(255,255,255,0.45)',
              letterSpacing: '0.06em',
            }}>
              github.com/FHIR-IQ/AINPI · @gene_vestel
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

// ── Master scene composition ────────────────────────────────────────────────

const SCENE_BREAKS = [4, 11, 21, 28, 35, 42, 48]; // cumulative end times (sec)

function VideoComposition({ width, height, accent = '#5b9dff' }) {
  const sceneIdx = useSceneIndex(SCENE_BREAKS);
  return (
    <>
      <Backdrop width={width} height={height} accent={accent} />
      <HeaderRail width={width} />
      <FooterRail width={width} height={height} currentScene={sceneIdx} totalScenes={7} />

      <SceneTitle        start={0}  end={4}  width={width} height={height} />
      <SceneBigNumber    start={4}  end={11} width={width} height={height} />
      <SceneTable        start={11} end={21} width={width} height={height} />
      <SceneSchemaBreak  start={21} end={28} width={width} height={height} />
      <SceneSSN          start={28} end={35} width={width} height={height} />
      <SceneVirginia     start={35} end={42} width={width} height={height} />
      <SceneCTA          start={42} end={48} width={width} height={height} />
    </>
  );
}

Object.assign(window, {
  VideoComposition, MONO, SANS, SERIF,
  Backdrop, HeaderRail, FooterRail,
  SceneTitle, SceneBigNumber, SceneTable, SceneSchemaBreak,
  SceneSSN, SceneVirginia, SceneCTA, USMap,
});
