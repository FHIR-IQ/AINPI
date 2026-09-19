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

Vivek Neshti (US) has installed CMS National Provider Directory: Release Archive in Azure Databricks
Here are the installation details:

Listing:\tCMS National Provider Directory: Release Archive
Installed by:\tVivek Neshti (US)
Installed on:\tSeptember 17, 2026
Company:\tNot specified
Email:\tvivek.neshti@pwc.com
Sharing identifier:\tazure:westus:a5b321b7-b747-4f5f-8eb7-75ad4a4c7d17
`;

const AWS_ADMIN = `Ronnie Miller has installed "CMS National Provider Directory: Release Archive".
Installation details:

Listing\tCMS National Provider Directory: Release Archive
Provider\tFHIR IQ
Installed by\tRonnie Miller
Installed on\tSeptember 17, 2026
Company\tNot specified
Email\tdatabricks-admin@medscout.io
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
      installedBy: 'Vivek Neshti (US)',
      installedOn: 'September 17, 2026',
      company: null,
      email: 'vivek.neshti@pwc.com',
      sharingIdentifier: 'azure:westus:a5b321b7-b747-4f5f-8eb7-75ad4a4c7d17',
    });
  });

  it('parses the tab-only format and ignores the Provider line', () => {
    const n = parseInstallNotice(AWS_ADMIN, null);
    expect(n?.installedBy).toBe('Ronnie Miller');
    expect(n?.email).toBe('databricks-admin@medscout.io');
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
    const n = parseInstallNotice(AZURE.replace('vivek.neshti@pwc.com', 'Vivek.Neshti@PwC.com'), null);
    expect(n?.email).toBe('vivek.neshti@pwc.com');
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
    expect(firstName('Vivek Neshti (US)')).toBe('Vivek');
    expect(firstName('Ronnie Miller')).toBe('Ronnie');
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
    expect(text.startsWith('Hi Vivek,')).toBe(true);
    expect(text).toContain('You installed');
    expect(html).toContain('Hi Vivek,');
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
    for (const bad of ['Datavant', 'PwC', 'MedScout', 'pricing', 'tier', '$']) {
      expect(text).not.toContain(bad);
      expect(html).not.toContain(bad);
    }
  });
});
