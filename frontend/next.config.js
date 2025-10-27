/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Empty string for serverless (Next.js API routes) - no external backend needed
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
}

module.exports = nextConfig
