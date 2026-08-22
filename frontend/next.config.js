/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Empty string for serverless (Next.js API routes) - no external backend needed
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
  // Headers belong here rather than in vercel.json: for a framework project
  // Vercel defers to the Next.js config, and headers set in vercel.json were
  // silently not applied.
  async headers() {
    return [
      {
        // The /api/v1 tree is the published static contract. External consumers
        // read it directly, so allow cross-origin reads and let the CDN serve
        // it without revalidating against the origin every time. Content only
        // changes on deploy, which purges the cache anyway.
        source: '/api/v1/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
          },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // /landscape was the original deep URL for the treemap. As of 2026-06-02
      // the homepage renders the same content directly; keep external bookmarks
      // and the social-share-card URL working.
      { source: '/landscape', destination: '/', permanent: true },
    ];
  },
  experimental: {
    // public/api/v1/** is served as static CDN assets by Vercel, never read from
    // inside a lambda at runtime — the loaders only touch them during `next build`
    // for static page generation. Tracer is over-inclusive and bundles them into
    // every serverless function, blowing past Vercel's 250 MB limit once the
    // per-state H37/H38/H39 CSVs and the 508K-row PECOS detail files landed.
    outputFileTracingExcludes: {
      '*': [
        'public/api/v1/findings/**',
        'public/api/v1/states/**',
        // The explorer payload is 51 state files of county and ZIP detail.
        // A new directory under public/api/v1/ is NOT covered by the two
        // entries above, and the tracer would bundle the whole thing into
        // every serverless function. Safe to exclude for the same reason as
        // the others: the loaders read these at build time for static pages,
        // and at runtime Vercel's CDN serves the JSON without touching a
        // lambda. If a route ever needs one of these at request time, this
        // needs rethinking rather than deleting.
        'public/api/v1/explorer/**',
      ],
    },
  },
}

module.exports = nextConfig
