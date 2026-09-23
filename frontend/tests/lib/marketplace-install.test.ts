import { describe, expect, it } from 'vitest';
import {
  buildInstallWelcome,
  firstName,
  parseInstallNotice,
} from '@/lib/marketplace-install';

// Three real notification bodies from the first week, as Gmail forwards
// them. They differ from each other: one carries a Provider line, one has a
// parenthetical in the name, one arrives from an admin mailbox, and the
// label separators are a mix of colon-tab and tab-only.
const AZURE = `---------- Forwarded message ---------
From: Databricks Marketplace <no-reply@databricks.com>
Subject: New installation of your listing

Alex Rivera (US) has installed CMS National Provider Directory: Release Archive in Azure Databricks
Here are the installation details:

Listing:\tCMS National Provider Directory: Release Archive
Installed by:\tAlex Rivera (US)
Installed on:\tSeptember 17, 2026
Company:\tNot specified
Email:\talex.rivera@example.com
Sharing identifier:\tazure:westus:a5b321b7-b747-4f5f-8eb7-75ad4a4c7d17
`;

const AWS_ADMIN = `Sam Lee has installed "CMS National Provider Directory: Release Archive".
Installation details:

Listing\tCMS National Provider Directory: Release Archive
Provider\tFHIR IQ
Installed by\tSam Lee
Installed on\tSeptember 17, 2026
Company\tNot specified
Email\tdatabricks-admin@example.net
Sharing identifier\taws
`;

const HTML_ONLY = `<html><body><p>Someone has installed your listing.</p>
<table><tr><td>Listing</td><td>CMS National Provider Directory: Release Archive</td></tr>
<tr><td>Installed by</td><td>Jane Q. Analyst</td></tr>
<tr><td>Installed on</td><td>September 18, 2026</td></tr>
<tr><td>Company</td><td>Example Health</td></tr>
<tr><td>Email</td><td>jane@example.org</td></tr>
<tr><td>Sharing identifier</td><td>aws:us-east-1:deadbeef</td></tr></table></body></html>`;

describe('parseInstallNotice', () => {
  it('parses the colon-tab format with a parenthetical in the name', () => {
    const n = parseInstallNotice(AZURE, null);
    expect(n).toEqual({
      listing: 'CMS National Provider Directory: Release Archive',
      installedBy: 'Alex Rivera (US)',
      installedOn: 'September 17, 2026',
      company: null,
      email: 'alex.rivera@example.com',
      sharingIdentifier: 'azure:westus:a5b321b7-b747-4f5f-8eb7-75ad4a4c7d17',
    });
  });

  it('parses the tab-only format and ignores the Provider line', () => {
    const n = parseInstallNotice(AWS_ADMIN, null);
    expect(n?.installedBy).toBe('Sam Lee');
    expect(n?.email).toBe('databricks-admin@example.net');
    expect(n?.sharingIdentifier).toBe('aws');
    expect(n?.company).toBeNull();
  });

  it('falls back to the HTML body when there is no text part', () => {
    const n = parseInstallNotice(null, HTML_ONLY);
    expect(n?.installedBy).toBe('Jane Q. Analyst');
    expect(n?.email).toBe('jane@example.org');
    expect(n?.company).toBe('Example Health');
  });

  it('lower-cases the email and treats "Not specified" as null', () => {
    const n = parseInstallNotice(AZURE.replace('alex.rivera@example.com', 'Alex.Rivera@Example.com'), null);
    expect(n?.email).toBe('alex.rivera@example.com');
    expect(n?.company).toBeNull();
  });

  it('returns null rather than a partial notice when the email is missing', () => {
    expect(parseInstallNotice(AZURE.replace(/Email:.*\n/, ''), null)).toBeNull();
  });

  it('returns null for unrelated mail', () => {
    expect(parseInstallNotice('Your Databricks bill is ready.', null)).toBeNull();
  });
});

describe('firstName', () => {
  it('drops parentheticals and takes the first token', () => {
    expect(firstName('Alex Rivera (US)')).toBe('Alex');
    expect(firstName('Sam Lee')).toBe('Sam');
    expect(firstName('Jane Q. Analyst')).toBe('Jane');
  });
  it('falls back to "there" when there is nothing usable', () => {
    expect(firstName('')).toBe('there');
    expect(firstName('(US)')).toBe('there');
  });
});

describe('buildInstallWelcome', () => {
  const n = parseInstallNotice(AZURE, null)!;
  it('addresses the reader by first name and says why they got it', () => {
    const { text, html, subject } = buildInstallWelcome(n);
    expect(text.startsWith('Hi Alex,')).toBe(true);
    expect(text).toContain('You installed');
    expect(html).toContain('Hi Alex,');
    expect(subject.length).toBeLessThan(80);
  });
  it('carries the two warnings, the three links and an opt-in subscribe', () => {
    const { text } = buildInstallWelcome(n);
    expect(text).toContain('release_date');
    expect(text).toContain('address, not id');
    expect(text).toContain('ainpi.dev/findings');
    expect(text).toContain('ainpi.dev/developer');
    expect(text).toContain('ainpi.dev/subscribe');
    expect(text).toContain('will not email you again');
  });
  it('never mentions another consumer or pricing', () => {
    const { text, html } = buildInstallWelcome(n);
    for (const bad of ['Acme Health', 'ExampleCo', 'pricing', 'tier', '$']) {
      expect(text).not.toContain(bad);
      expect(html).not.toContain(bad);
    }
  });
});
