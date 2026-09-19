/**
 * marketplace-install: turn a Databricks Marketplace install notification
 * into a welcome email.
 *
 * Databricks emails the provider contact when a consumer installs a listing,
 * and on this account that email is the only signal there is: the listing
 * `installations` API returns "No API found". A Gmail filter forwards the
 * notice to installs@ainpi.dev (a Resend inbox), Resend posts an
 * `email.received` webhook to /api/v1/marketplace-install, and that route
 * calls the two functions here.
 *
 * The parser is deliberately loose about layout and strict about outcome.
 * Three notices in the first week used three different label separators
 * (colon-tab, tab, HTML table cells), so labels are matched by name and the
 * value is whatever follows on the line. But a notice with no email is
 * returned as null rather than as a partial record, because a welcome sent
 * to nobody, or addressed to "Hi undefined", is worse than no welcome.
 */

export interface InstallNotice {
  listing: string;
  installedBy: string;
  installedOn: string | null;
  /** Null when Databricks says "Not specified". */
  company: string | null;
  email: string;
  /** "aws", "azure:westus:<uuid>", etc. Cloud and region of the consumer. */
  sharingIdentifier: string | null;
}

const SITE = 'https://ainpi.dev';
const LISTING_NAME_HINT = 'Release Archive';

function htmlToText(html: string): string {
  return html
    .replace(/<\/(td|th|p|div|tr|li|h\d)>/gi, (m) => (/tr/i.test(m) ? '\n' : '\t'))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Value after a label on the same line. Separator may be ":", tab, or both. */
function field(text: string, label: string): string | null {
  const re = new RegExp(`^\\s*${label}\\s*:?\\s*[\\t ]*(.+?)\\s*$`, 'im');
  const m = text.match(re);
  if (!m) return null;
  const v = m[1].trim();
  return v.length ? v : null;
}

export function parseInstallNotice(
  text: string | null,
  html: string | null,
): InstallNotice | null {
  const body = text && text.trim().length ? text : html ? htmlToText(html) : '';
  if (!body) return null;
  // Cheap gate so ordinary mail forwarded by mistake never becomes a welcome.
  if (!/installed/i.test(body) || !/Installed by/i.test(body)) return null;

  const emailRaw = field(body, 'Email');
  const email = emailRaw?.toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

  const installedBy = field(body, 'Installed by');
  if (!installedBy) return null;

  const listing = field(body, 'Listing') ?? LISTING_NAME_HINT;
  const companyRaw = field(body, 'Company');
  const company =
    companyRaw && !/^not specified$/i.test(companyRaw) ? companyRaw : null;

  return {
    listing,
    installedBy,
    installedOn: field(body, 'Installed on'),
    company,
    email,
    sharingIdentifier: field(body, 'Sharing identifier'),
  };
}

export function firstName(installedBy: string): string {
  const cleaned = installedBy.replace(/\([^)]*\)/g, ' ').trim();
  const tok = cleaned.split(/\s+/)[0] ?? '';
  return /^[A-Za-z][A-Za-z'’-]*$/.test(tok) ? tok : 'there';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Short by design: why they got it, what it is in two sentences, the two
 * mistakes a first query makes, three links, and an opt-in. It is sent once
 * per address and says so. No list enrolment happens here.
 */
export function buildInstallWelcome(n: InstallNotice): {
  subject: string;
  text: string;
  html: string;
} {
  const name = firstName(n.installedBy);
  const subject = 'The NDH release archive you installed, in five sentences';

  const text = [
    `Hi ${name},`,
    '',
    'You installed the CMS National Provider Directory release archive on',
    'Databricks Marketplace, so here is what it is and how not to trip on it.',
    '',
    'CMS keeps only the newest export of the directory. The archive keeps',
    'every release since May, six tables, split by release_date. Filter on',
    'that column or you will read both releases at once.',
    '',
    'Endpoint and Location ids are regenerated every export. Diff them on',
    'address, not id. Practitioner ids embed the NPI and are stable.',
    '',
    'Worked example: the notebook attached to the listing.',
    `What we have measured: ${SITE}/findings`,
    `Free API and MCP server: ${SITE}/developer`,
    '',
    'We publish an update when a release lands and when a number changes.',
    `If you want those, subscribe here: ${SITE}/subscribe`,
    'We will not email you again otherwise.',
    '',
    'Reply to this address and a person answers.',
    '',
    'Gene Vestel, FHIR IQ',
  ].join('\n');

  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${s}</p>`;
  const a = (href: string, label: string) =>
    `<a href="${href}" style="color:#08519c;">${esc(label)}</a>`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px 20px;color:#171310;background:#faf8f5;">
${p(`Hi ${esc(name)},`)}
${p('You installed the CMS National Provider Directory release archive on Databricks Marketplace, so here is what it is and how not to trip on it.')}
${p('CMS keeps only the newest export of the directory. The archive keeps every release since May, six tables, split by <code>release_date</code>. Filter on that column or you will read both releases at once.')}
${p('Endpoint and Location ids are regenerated every export. Diff them on address, not id. Practitioner ids embed the NPI and are stable.')}
${p(`Worked example: the notebook attached to the listing.<br>What we have measured: ${a(`${SITE}/findings`, 'ainpi.dev/findings')}<br>Free API and MCP server: ${a(`${SITE}/developer`, 'ainpi.dev/developer')}`)}
${p(`We publish an update when a release lands and when a number changes. If you want those, ${a(`${SITE}/subscribe`, 'subscribe here')}. We will not email you again otherwise.`)}
${p('Reply to this address and a person answers.')}
${p('Gene Vestel, FHIR IQ')}
</div>`.trim();

  return { subject, text, html };
}
