import Link from 'next/link';
import SubscriberCount from './SubscriberCount';

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
        <div>
          <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 mb-3">
            Resources
          </h3>
          <ul className="space-y-2">
            <li><Link href="/methodology" className="hover:text-white">Methodology</Link></li>
            <li><Link href="/data-sources" className="hover:text-white">Data sources</Link></li>
            <li><Link href="/smd-revalidation" className="hover:text-white">SMD-response citation language</Link></li>
            <li><a href="https://github.com/FHIR-IQ/AINPI" target="_blank" rel="noopener noreferrer" className="hover:text-white">GitHub</a></li>
            <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
            <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
            <li><Link href="/security" className="hover:text-white">Security</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 mb-3">
            Tools
          </h3>
          <ul className="space-y-2">
            <li><Link href="/npd" className="hover:text-white">NPD search</Link></li>
            <li><Link href="/provider-search" className="hover:text-white">Cross-source provider search</Link></li>
            <li><Link href="/magic-scanner" className="hover:text-white">Magic Scanner</Link></li>
            <li><Link href="/payer-healthcare-service-survey" className="hover:text-white">Healthcare Service Survey</Link></li>
            <li><Link href="/data-quality" className="hover:text-white">Data quality dashboard</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 mb-3">
            Stay current
          </h3>
          <ul className="space-y-2">
            <li>
              <Link href="/subscribe" className="hover:text-white">
                Subscribe to updates
              </Link>
              <span className="block text-xs text-slate-500 mt-0.5">
                <SubscriberCount />
              </span>
            </li>
            <li><Link href="/reports/2026-05-14-update" className="hover:text-white">Latest release update</Link></li>
            <li><Link href="/insights" className="hover:text-white">Provenance + variance analysis</Link></li>
            <li><Link href="/api/v1/manifest.json" className="hover:text-white">API manifest (JSON)</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800 px-4 sm:px-6 lg:px-8 py-5 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          © 2026{' '}
          <a
            href="https://fhiriq.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300"
          >
            FHIR IQ
          </a>
          {' · '}
          <a
            href="https://github.com/FHIR-IQ/AINPI/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300"
          >
            Apache-2.0
          </a>
          {' · Methodology v0.6.1-draft · '}
          <a
            href="mailto:gene@fhiriq.com"
            className="hover:text-slate-300"
          >
            gene@fhiriq.com
          </a>
        </div>
        <div className="text-slate-500">
          Audit of the CMS National Directory of Healthcare
        </div>
      </div>
    </footer>
  );
}
