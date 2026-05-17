import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import MapHomepage from '@/components/homepage/MapHomepage';
import { loadHomepageMapData } from '@/lib/homepage-data';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'AINPI — Audit of the federal provider directory',
  description:
    'A free, public audit of the CMS National Directory of Healthcare. Click any state to see federally-excluded NPIs still listed in the federal directory and the claims-side cross-audit for that state.',
};

export default function HomePage() {
  const data = loadHomepageMapData();
  return (
    <>
      <Navbar />
      <MapHomepage data={data} />
    </>
  );
}
