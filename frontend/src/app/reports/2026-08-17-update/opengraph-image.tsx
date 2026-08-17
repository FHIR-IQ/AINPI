import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'AINPI 2026-08-17 release update';

/**
 * Share card for the release update.
 *
 * Release pages had no OG image at all, so a subscriber forwarding one to
 * LinkedIn got a bare link. These are the pages most likely to be shared by
 * someone other than us, which makes them the worst ones to leave blank.
 *
 * Numbers are literals rather than a payload read, because a release update
 * is a dated snapshot: the finding JSON is regenerated weekly and this page
 * describes what was true on 2026-08-17. Pulling live numbers into a dated
 * card would silently rewrite history.
 */
export default async function Image() {
  return renderOgCard({
    eyebrow: 'Release update · 2026-08-17',
    title:
      'The directory knows doctors. It barely knows nurses, dentists and pharmacists.',
    stats: [
      { value: '77.9%', label: 'Nurse practitioners and PAs' },
      { value: '4.7%', label: 'Dentists' },
      { value: '1 of 12,995', label: 'Pharmacy workers' },
    ],
  });
}
