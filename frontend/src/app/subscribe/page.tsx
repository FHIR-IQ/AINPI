import Navbar from '@/components/Navbar';
import SubstackSignupForm from '@/components/SubstackSignupForm';
import { NEWSLETTER_NAME } from '@/lib/newsletter';

export default function SubscribePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Subscribe for updates</h1>
        <p className="text-gray-600 mb-8">
          AINPI findings, release updates and the annual <em>State of the NDH</em> report go out
          in <em>{NEWSLETTER_NAME}</em>, Eugene Vestel&apos;s free newsletter on Substack,
          alongside the <em>Out of the FHIR</em> podcast and essays on FHIR and healthcare data.
        </p>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <label htmlFor="subscribe-email" className="block text-sm font-medium text-gray-700 mb-2">
            Email address
          </label>
          <SubstackSignupForm
            source="subscribe_page"
            id="subscribe-email"
            formClassName="flex flex-col gap-4"
            inputClassName="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            buttonClassName="self-start px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40"
          />
          <p className="mt-4 text-xs text-gray-500">
            Subscribing takes you to Substack, which sends the newsletter. It is free, and every
            issue has an unsubscribe link. The address is also saved on ainpi.dev so we can see
            which pages bring readers; to remove it, email{' '}
            <a href="mailto:gene@fhiriq.com" className="underline">gene@fhiriq.com</a>. See the{' '}
            <a href="/privacy" className="underline">privacy policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
