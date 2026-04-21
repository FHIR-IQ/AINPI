import { Github, ExternalLink } from 'lucide-react';

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
              <li><a href="/methodology" className="hover:text-white">Methodology</a></li>
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
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 hover:text-gray-300"
              aria-label="GitHub repository"
            >
              <Github className="w-4 h-4" /> GitHub
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
