import { ExternalLink } from 'lucide-react';
import SubscriberCount from './SubscriberCount';

// Inline GitHub mark — lucide-react removed `Github` in 1.x for brand-licensing
// reasons. Self-contained SVG keeps us version-agnostic across lucide bumps.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const REPO_URL = 'https://github.com/FHIR-IQ/AINPI';

export default function Footer() {
  return (
    <footer className="mt-16 border-t bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Audit
            </h3>
            <ul className="space-y-2">
              <li><a href="/findings" className="hover:text-white">Findings</a></li>
              <li><a href="/states" className="hover:text-white">State audits</a></li>
              <li><a href="/smd-revalidation" className="hover:text-white">For state Medicaid</a></li>
              <li><a href="/methodology" className="hover:text-white">Methodology</a></li>
              <li><a href="/data-sources" className="hover:text-white">Data sources</a></li>
              <li><a href="/npd" className="hover:text-white">NPI search</a></li>
              <li><a href="/api/v1/stats.json" className="hover:text-white font-mono text-xs">/api/v1/stats.json</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Community
            </h3>
            <ul className="space-y-2">
              <li>
                <a
                  href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  Contribute on GitHub
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/issues`}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  Issues & roadmap
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/pulls`}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  Open pull requests
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a href="/subscribe" className="hover:text-white">Subscribe for updates</a>
              </li>
              <li>
                <a href="/download" className="hover:text-white">Download the report</a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Related projects
            </h3>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://fhiriq.com"
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  FHIR IQ
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://healthclaw.io"
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  Healthclaw
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/FHIR-IQ/ainpi-probe"
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  ainpi-probe (crawler)
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/FHIR-IQ/ainpi-examples"
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  ainpi-examples
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              About
            </h3>
            <ul className="space-y-2">
              <li><a href="/faq" className="hover:text-white">FAQ</a></li>
              <li><a href="/privacy" className="hover:text-white">Privacy</a></li>
              <li><a href="/security" className="hover:text-white">Security</a></li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white"
                >
                  License (Apache-2.0)
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/CITATION.cff`}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-white"
                >
                  Cite AINPI
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-gray-500">
          <p>
            © 2026 <a href="https://fhiriq.com" target="_blank" rel="noopener" className="hover:text-gray-300">FHIR IQ</a>
            {' '}· Apache-2.0
            {' '}· <a href={REPO_URL} target="_blank" rel="noopener" className="hover:text-gray-300">FHIR-IQ/AINPI</a>
          </p>
          <div className="flex items-center gap-4">
            <SubscriberCount className="text-gray-400 hover:text-gray-200" />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 hover:text-gray-300"
              aria-label="GitHub repository"
            >
              <GithubMark className="w-4 h-4" /> GitHub
            </a>
            <a href="mailto:gene@fhiriq.com" className="hover:text-gray-300">
              gene@fhiriq.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
