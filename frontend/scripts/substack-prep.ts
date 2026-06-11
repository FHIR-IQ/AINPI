/**
 * scripts/substack-prep.ts
 *
 * Prepares a newsletter for the FHIR IQ Playbook Substack channel after the
 * AINPI Resend blast has already gone out.
 *
 * Honest scope: Substack does not publish a stable public API for sending a
 * post to subscribers. Their app talks to internal endpoints under
 * /api/v1/* that work but are not officially supported and can change
 * without warning. This script supports two modes:
 *
 *   1) PREPARE  (default, no auth required)
 *      Reads a markdown source file, formats it for Substack pasting (a few
 *      structural rewrites the Substack editor likes), copies the result to
 *      the clipboard via pbcopy/xclip when available, and prints the
 *      new-post URL so you can paste and publish manually. ~30 seconds.
 *
 *   2) AUTO-DRAFT  (requires SUBSTACK_COOKIE + SUBSTACK_PUBLICATION env vars)
 *      Creates a *draft* via the unofficial /api/v1/drafts endpoint. Still
 *      requires you to click Publish in the Substack editor — this is
 *      deliberate so the second-channel send is not a one-keypress mistake.
 *      Brittle by definition; if Substack changes the schema this will need
 *      a maintenance pass.
 *
 * Workflow with the existing per-newsletter scripts:
 *
 *   # 1. Run the existing AINPI Resend blast (e.g. send-2026-06-04-update.ts)
 *   npx tsx scripts/send-2026-06-04-update.ts --confirm
 *
 *   # 2. Prepare the Substack version from the SAME markdown source
 *   npx tsx scripts/substack-prep.ts docs/reports/2026-06-04-update.md \
 *       --title "AINPI follow-up: two methodology clarifications" \
 *       --subtitle "..." [--auto-draft]
 *
 *   # 3. The script prints the publish URL. Open it, paste, click Publish.
 *
 * Env vars (only needed for --auto-draft):
 *   SUBSTACK_COOKIE       Full Cookie header from a logged-in browser
 *                         session. Extract from DevTools -> Application ->
 *                         Cookies -> substack.com. Treat as a password.
 *   SUBSTACK_PUBLICATION  The publication subdomain (e.g. "fhiriqplaybook"
 *                         for https://fhiriqplaybook.substack.com).
 *
 * NOTE: this script never reads or modifies the AINPI subscriber list. It
 * touches the Substack channel only.
 */

import { readFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';

interface CliArgs {
  source: string | null;
  title: string | null;
  subtitle: string | null;
  autoDraft: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { source: null, title: null, subtitle: null, autoDraft: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') out.title = argv[++i] ?? null;
    else if (a === '--subtitle') out.subtitle = argv[++i] ?? null;
    else if (a === '--auto-draft') out.autoDraft = true;
    else if (a === '-h' || a === '--help') {
      console.log('See header comment in scripts/substack-prep.ts');
      process.exit(0);
    } else if (!a.startsWith('--')) {
      out.source = a;
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

/**
 * Apply the same prose rules the copy-reviewer agent enforces, before the
 * markdown ever reaches the Substack editor. This is a mechanical pass; it
 * does NOT replace running the copy-reviewer on the draft.
 *
 *  - Em-dashes and en-dashes become periods (most common case).
 *  - Smart quotes normalize to straight quotes.
 *  - Wraps the doc in title + subtitle if provided.
 */
function prepareForSubstack(markdown: string, title: string | null, subtitle: string | null): string {
  // Em-dash and en-dash handling. Crude period substitution would land
  // orphan periods mid-sentence ("would be wrong . and H43"). Comma is a
  // safer mechanical default for the connecting-clauses case.
  //
  // Special-case the leading-signature line: a line that starts with
  // "— Name" is the standard email sign-off; promote to "-- Name" so the
  // signature doesn't end up as a period in column 1.
  //
  // Known limitation: a SOURCE em-dash that line-wraps to column 1 mid-
  // document (e.g. "script —\n[link](...)\n— is committed") trips the
  // signature heuristic and produces a stray "-- " mid-prose. Eyeball the
  // output before publishing; the editor is the last line of defense.
  const cleaned = markdown
    .replace(/^—\s/gm, '-- ')
    .replace(/\s—\s/g, ', ')
    .replace(/—/g, '')
    .replace(/\s–\s/g, ', ')
    .replace(/–/g, '')
    // Collapse any double-commas the substitution created.
    .replace(/,\s*,/g, ',')
    // Smart quotes to straight.
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Trim excessive blank lines.
    .replace(/\n{3,}/g, '\n\n');

  const parts: string[] = [];
  if (title) parts.push(`# ${title}\n`);
  if (subtitle) parts.push(`*${subtitle}*\n`);
  parts.push(cleaned.trim());
  parts.push('\n');
  return parts.join('\n');
}

function copyToClipboard(text: string): boolean {
  // Try pbcopy (macOS), xclip (Linux X11), wl-copy (Wayland), then give up.
  for (const cmd of ['pbcopy', 'xclip -selection clipboard', 'wl-copy']) {
    const [bin, ...rest] = cmd.split(' ');
    const r = spawnSync(bin, rest, { input: text });
    if (r.status === 0) return true;
  }
  return false;
}

async function createSubstackDraft(
  text: string,
  title: string,
  subtitle: string | null,
  publication: string,
  cookie: string,
): Promise<void> {
  // Substack's unofficial /api/v1/drafts endpoint. Schema is what the web
  // editor sends; subject to change without warning. The minimum payload
  // observed (2026-06) is title + body_json + audience. We send a plain-text
  // body_json shape; Substack converts on save.
  const body = {
    type: 'newsletter',
    title,
    subtitle: subtitle ?? '',
    audience: 'everyone',
    body: text,
    section_chosen: false,
  };

  const url = `https://${publication}.substack.com/api/v1/drafts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'user-agent': 'ainpi-substack-prep/0.1.0',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Substack /drafts returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id?: number; slug?: string };
  if (!data.id) {
    throw new Error(`Substack /drafts response missing id: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const editorUrl = `https://${publication}.substack.com/publish/post/${data.id}`;
  console.log(`Draft created: ${editorUrl}`);
  console.log('Review in the Substack editor, then click Publish.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) {
    console.error('Usage: npx tsx scripts/substack-prep.ts <markdown-file> [--title T] [--subtitle S] [--auto-draft]');
    process.exit(2);
  }

  const sourcePath = path.resolve(args.source);
  const raw = readFileSync(sourcePath, 'utf-8');
  const text = prepareForSubstack(raw, args.title, args.subtitle);

  if (args.autoDraft) {
    const cookie = process.env.SUBSTACK_COOKIE;
    const publication = process.env.SUBSTACK_PUBLICATION;
    if (!cookie || !publication) {
      console.error(
        'AUTO-DRAFT mode requires SUBSTACK_COOKIE and SUBSTACK_PUBLICATION env vars.',
      );
      console.error('Extract the Cookie header from a logged-in Substack browser session');
      console.error('(DevTools -> Application -> Cookies -> substack.com).');
      process.exit(1);
    }
    if (!args.title) {
      console.error('AUTO-DRAFT mode requires --title.');
      process.exit(2);
    }
    await createSubstackDraft(text, args.title, args.subtitle, publication, cookie);
    return;
  }

  // PREPARE mode: copy to clipboard + print the editor URL.
  console.log('--- Substack-prepped markdown ---');
  console.log(text);
  console.log('--- end ---');
  console.log('');

  const copied = copyToClipboard(text);
  if (copied) {
    console.log('Copied to clipboard.');
  } else {
    console.log('Clipboard copy failed (no pbcopy/xclip/wl-copy available).');
    console.log('Copy the block above by hand.');
  }

  const publication = process.env.SUBSTACK_PUBLICATION || 'fhiriqplaybook';
  console.log(`Open the new-post editor: https://${publication}.substack.com/publish/post`);
  console.log('Paste, set the title/subtitle if not already, and Publish.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
