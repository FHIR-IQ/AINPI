import Link from 'next/link';

/**
 * "Request removal of this page" link for an individual's page, with the NPI
 * prefilled in the /privacy/remove form. The form is the standard way to
 * have a page removed; nothing after it waits on a person.
 */
export default function RemovalRequestLink({ npi }: { npi: string }) {
  const clean = /^\d{10}$/.test(npi) ? npi : '';
  return (
    <p className="text-sm text-gray-600">
      <Link
        href={clean ? `/privacy/remove?npi=${clean}` : '/privacy/remove'}
        className="underline hover:text-gray-900"
        rel="nofollow"
      >
        Request removal of this page
      </Link>
    </p>
  );
}
