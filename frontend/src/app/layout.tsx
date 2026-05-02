import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import WipBanner from '@/components/WipBanner'
import Footer from '@/components/Footer'
import LatestUpdates from '@/components/LatestUpdates'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({ subsets: ['latin'] })

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
    <html lang="en">
      <body className={inter.className}>
        <WipBanner />
        <LatestUpdates />
        {children}
        <Footer />
        <Analytics />
      </body>
    </html>
  )
}
