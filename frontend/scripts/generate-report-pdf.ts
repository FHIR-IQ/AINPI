#!/usr/bin/env npx tsx
/**
 * Generates the binary AINPI report PDF from the live /report page.
 *
 * Flow:
 *   1. Spawn `next dev` as a child process (or attach to an existing dev
 *      server on port 3000 — if one is already running we reuse it)
 *   2. Wait for /report to 200
 *   3. Use Playwright (already a dev dep) to print /report to PDF
 *      at Letter @ 0.75in margins
 *   4. Save to frontend/public/downloads/ainpi-state-of-ndh-<version>.pdf
 *
 * Usage:
 *   npm run report:pdf
 *   npm run report:pdf -- --version=v1.0.0
 *
 * Output lives in the repo so the /download redirect can serve it
 * statically via Vercel. Regenerate on each release tag.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const DEFAULT_VERSION = 'v1.0.0';
const PORT = 3001; // avoid clashing with a running dev server on 3000
const REPORT_URL = `http://localhost:${PORT}/report`;
const OUT_DIR = path.resolve(process.cwd(), 'public', 'downloads');

function getVersion(): string {
  const arg = process.argv.find((a) => a.startsWith('--version='));
  return arg ? arg.split('=')[1] : DEFAULT_VERSION;
}

async function waitForHttp(url: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const version = getVersion();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `ainpi-state-of-ndh-${version}.pdf`);

  console.log(`> starting next dev on :${PORT}`);
  const dev: ChildProcess = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Track dev output for troubleshooting without flooding
  let devSawReady = false;
  dev.stdout?.on('data', (chunk) => {
    const s = chunk.toString();
    if (!devSawReady && s.includes('Ready in')) {
      devSawReady = true;
      console.log(`  next dev ready`);
    }
  });
  dev.stderr?.on('data', (chunk) => {
    const s = chunk.toString();
    if (/error|ERR/i.test(s)) process.stderr.write(`[next]  ${s}`);
  });

  const shutdown = () => {
    try {
      dev.kill('SIGTERM');
    } catch {
      // ignore
    }
  };
  process.on('exit', shutdown);
  process.on('SIGINT', shutdown);

  try {
    console.log('> waiting for /report to respond');
    await waitForHttp(REPORT_URL);

    console.log('> launching headless browser');
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 1600 } });
    const page = await ctx.newPage();

    console.log(`> navigating to ${REPORT_URL}`);
    await page.goto(REPORT_URL, { waitUntil: 'networkidle' });

    // Give any client-side effects a moment to settle (stats fetch on pages,
    // chart animation, etc.) before we snapshot.
    await page.waitForTimeout(2_000);

    console.log(`> writing PDF to ${path.relative(process.cwd(), outFile)}`);
    await page.pdf({
      path: outFile,
      format: 'Letter',
      margin: { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();
    const size = fs.statSync(outFile).size;
    console.log(`> done (${(size / 1024).toFixed(1)} KB)`);
  } finally {
    shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
