/**
 * Read an environment variable, trimmed.
 *
 * WHY THIS EXISTS
 *
 * Nine of this project's production environment variables carry a trailing
 * newline inside the value itself. `BQ_DATASET_ID` is literally `"cms_npd\n"`.
 * That is what `echo "cms_npd" | vercel env add` stores: echo appends the
 * newline and Vercel keeps it, because it cannot know the newline was the
 * shell's rather than yours.
 *
 * Most of the time nothing notices. A Postgres connection string tolerates
 * trailing whitespace, a URL parser trims, an HTTP header gets normalised. So
 * the values sat there working for four months.
 *
 * Then a query used them inside a backtick-quoted BigQuery identifier:
 *
 *     FROM `thematic-fort-453901-t7
 *     .cms_npd
 *     .location`
 *
 *     Syntax error: Unclosed identifier literal at [8:14]
 *
 * The route worked locally, because the local .env.local does not set either
 * variable and the code fell back to its hardcoded defaults. It failed only in
 * production, only on the one route that quoted the identifier, and the
 * older route next to it kept working because it built the same table name
 * without backticks and BigQuery tolerates whitespace around the dots there.
 *
 * Trimming at the read site fixes every consumer at once and cannot regress.
 * The stored values are still worth cleaning up, but nothing should depend on
 * that having been done.
 */

/** Trimmed value, or the fallback when unset or empty after trimming. */
export function env(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

/** Trimmed value, or undefined. For genuinely optional configuration. */
export function envOptional(name: string): string | undefined {
  const raw = process.env[name];
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Trimmed value, or throw. For configuration whose absence is a bug. */
export function envRequired(name: string): string {
  const v = envOptional(name);
  if (v === undefined) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return v;
}
