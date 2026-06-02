import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import MapHomepage from '@/components/homepage/MapHomepage';
import { loadHomepageMapData } from '@/lib/homepage-data';
import { HomepageLatestStrip } from '@/components/findings-hub/HomepageLatestStrip';
import { loadHubFeed } from '@/lib/hub-feed';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI map — federally-excluded providers by state',
  description:
    'US choropleth of the AINPI audit. Click any state to see federally-excluded NPIs still listed in the federal directory and the claims-side cross-audit for that state.',
  openGraph: {
    title: 'AINPI map — federally-excluded providers by state',
    description:
      'Interactive US choropleth. Click any state to see federally-excluded NPIs still listed in the directory and the claims-side cross-audit for that state.',
    url: 'https://ainpi.dev/map',
    type: 'website',
  },
};

export default function MapPage() {
  const data = loadHomepageMapData();
  const { lead } = loadHubFeed();
  return (
    <>
      <Navbar />
      <MapHomepage data={data} />
      <HomepageLatestStrip lead={lead} />
    </>
  );
}
