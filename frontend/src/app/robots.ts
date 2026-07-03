import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/npd/',       // live BQ-backed routes; crawling them costs money
          '/api/provider-search',
          '/api/magic-scanner',
          '/api/auth/',
          '/dashboard',
          '/audit-log',
          '/login',
          '/demo',
          '/providers/',
        ],
      },
    ],
    sitemap: 'https://ainpi.dev/sitemap.xml',
  };
}
