// Markdown files imported from code are bundled as their source text by the
// asset/source rule in next.config.js (and the matching plugin in
// vitest.config.ts).
declare module '*.md' {
  const source: string;
  export default source;
}
