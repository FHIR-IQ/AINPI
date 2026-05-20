/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Empty string for serverless (Next.js API routes) - no external backend needed
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
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
      ],
    },
  },
}

module.exports = nextConfig
