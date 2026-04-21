/**
 * Shared markdown-page loader. Reads a markdown file from anywhere under
 * the repo (path is resolved relative to the repo root, NOT the Next.js
 * project root), parses YAML front matter, and returns front-matter
 * + body for rendering.
 *
 * Used by /methodology, /faq, /privacy, /security (and any future
 * markdown-rendered page).
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

// Next.js runs from frontend/, so repo root is one level up
const REPO_ROOT = path.join(process.cwd(), '..');

function coerceToStrings(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
    } else if (v == null) {
      out[k] = '';
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

export interface MarkdownDoc {
  frontMatter: Record<string, string>;
  body: string;
}

/**
 * Load a markdown file by repo-relative path (e.g. 'docs/faq.md').
 *
 * Returns a fallback stub if the file is missing so pages don't crash.
 */
export function loadMarkdown(
  repoRelativePath: string,
  fallbackTitle: string,
): MarkdownDoc {
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, repoRelativePath), 'utf8');
    const { data, content } = matter(raw);
    return {
      frontMatter: coerceToStrings(data as Record<string, unknown>),
      body: content,
    };
  } catch {
    return {
      frontMatter: { title: fallbackTitle, version: 'missing' },
      body: `> Document not found on disk. Looked at \`${repoRelativePath}\`.`,
    };
  }
}
