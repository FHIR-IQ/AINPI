/**
 * Site-wide metadata constants bundled into every page (no runtime fs).
 *
 * METHODOLOGY_VERSION must be bumped whenever docs/methodology/version-log.md
 * gains a new top entry — it is the only place the version is hardcoded in
 * app code; everything else derives from the version-log frontmatter at
 * build time (hub-feed) or ships inside finding JSONs.
 */
export const METHODOLOGY_VERSION = '0.7.2-draft';
