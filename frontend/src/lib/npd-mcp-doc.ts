/**
 * The NPD MCP tool-goals document (docs/npd-mcp/tool-goals.md), bundled into
 * the build as text. /npd-mcp re-renders in a lambda every 10 minutes, and
 * Vercel's Root Directory is frontend/, so a runtime read of ../docs could
 * find nothing there. Importing the file makes it part of the bundle instead:
 * webpack's asset/source rule in next.config.js turns it into a string.
 */
import { parseMarkdown, type MarkdownDoc } from '@/lib/load-markdown';
import raw from '../../../docs/npd-mcp/tool-goals.md';

export const TOOL_GOALS_DOC: MarkdownDoc = parseMarkdown(raw);
