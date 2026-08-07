import type { Metadata } from 'next'
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import WipBanner from '@/components/WipBanner'
import Footer from '@/components/Footer'
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/JsonLd'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

// Display serif carries the editorial authority; the Plex family handles
// interface and dense numeric tables. Loaded as CSS variables so Tailwind's
// font tokens resolve to them.
const display = Newsreader({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  style: ['normal', 'italic'],
})
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  // Without metadataBase, Next.js cannot resolve relative Open Graph image
  // URLs, so every generated card would be dropped by the crawlers that
  // matter. This is the line that makes the og cards work at all.
  metadataBase: new URL('https://ainpi.dev'),
  title: {
    default: 'AINPI: an open audit of the federal provider directory',
    // Child pages set their own title; this keeps the publication name on it.
    template: '%s | AINPI',
  },
  description:
    'An open, reproducible audit of the CMS National Provider Directory. 21.7M FHIR records, 31 pre-registered findings, every number traceable to a public federal source.',
  applicationName: 'AINPI',
  keywords: [
    'CMS National Provider Directory',
    'NPPES',
    'FHIR',
    'provider directory accuracy',
    'health data quality',
    'NDH',
    'rural health',
    'interoperability',
  ],
  authors: [{ name: 'AINPI' }],
  alternates: {
    canonical: '/',
    types: { 'application/rss+xml': [{ url: '/feed.xml', title: 'AINPI findings and updates' }] },
  },
  openGraph: {
    type: 'website',
    siteName: 'AINPI',
    url: 'https://ainpi.dev',
    title: 'AINPI: an open audit of the federal provider directory',
    description:
      '21.7M FHIR records, 31 pre-registered findings, every number traceable to a public federal source.',
  },
  twitter: {
    // The site previously emitted the small summary card. Large cards are the
    // difference between a link and a piece of published work in a feed.
    card: 'summary_large_image',
    title: 'AINPI: an open audit of the federal provider directory',
    description:
      '21.7M FHIR records, 31 pre-registered findings, every number traceable to a public federal source.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans bg-paper text-ink antialiased">
        <WipBanner />
        {children}
        <Footer />
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
