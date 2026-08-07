import type { Metadata } from 'next'
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import WipBanner from '@/components/WipBanner'
import Footer from '@/components/Footer'
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
  title: 'AINPI - CMS National Provider Directory Explorer',
  description: 'Experimental exploration of the CMS National Provider Directory public use files.',
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
