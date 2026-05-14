'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import {
  HCS_CATEGORIES,
  HCS_MUST_SUPPORT_FIELDS,
  HCS_FHIR_PROFILES,
  HCS_CADENCES,
  HCS_UPSTREAM_SOURCES,
  HCS_ROLE_TYPES,
} from '@/data/healthcare-service-survey';

interface FormState {
  email: string;
  name: string;
  organization: string;
  roleType: string;
  categoriesUsed: Set<string>;
  categoriesPain: Set<string>;
  mustSupportFields: Set<string>;
  consumerOf: Set<string>;
  fhirProfile: string;
  identifierSystem: string;
  publishCadence: string;
  painPoints: string;
  recommendations: string;
  wantsFollowUp: boolean;
}

const initial: FormState = {
  email: '',
  name: '',
  organization: '',
  roleType: '',
  categoriesUsed: new Set(),
  categoriesPain: new Set(),
  mustSupportFields: new Set(),
  consumerOf: new Set(),
  fhirProfile: '',
  identifierSystem: '',
  publishCadence: '',
  painPoints: '',
  recommendations: '',
  wantsFollowUp: false,
};

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default function PayerHealthcareServiceSurveyPage() {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/healthcare-service-survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email || null,
          name: form.name || null,
          organization: form.organization || null,
          roleType: form.roleType || null,
          categoriesUsed: [...form.categoriesUsed],
          categoriesPain: [...form.categoriesPain],
          mustSupportFields: [...form.mustSupportFields],
          consumerOf: [...form.consumerOf],
          fhirProfile: form.fhirProfile || null,
          identifierSystem: form.identifierSystem || null,
          publishCadence: form.publishCadence || null,
          painPoints: form.painPoints || null,
          recommendations: form.recommendations || null,
          wantsFollowUp: form.wantsFollowUp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'submission failed');
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="bg-white border rounded-lg p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Response captured.
            </h1>
            <p className="text-gray-700 mb-6 max-w-xl mx-auto">
              Thanks. Your answers feed directly into the AINPI recommendation
              for the NPD weekly call. If you flagged that you wanted a
              follow-up conversation, expect an email at{' '}
              <span className="font-mono text-sm">{form.email || 'the address you provided'}</span>{' '}
              within a week.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="/payer-healthcare-service-survey/results"
                className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-md"
              >
                View running aggregate →
              </a>
              <a
                href="https://github.com/FHIR-IQ/AINPI/issues"
                className="inline-flex items-center px-4 py-2 bg-white border text-gray-700 hover:bg-gray-50 text-sm font-semibold rounded-md"
              >
                Track the work on GitHub →
              </a>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-widest text-primary-600 font-mono mb-2">
            NPD weekly · community input
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3 tracking-tight">
            Standardizing HealthcareService data from payers
          </h1>
          <p className="text-gray-700 leading-relaxed mb-4">
            The NPD weekly raised that payers (and the integrators who serve
            them) ship FHIR HealthcareService resources very differently — the
            categories don&apos;t line up, the must-support fields are
            half-populated, and the identifier system is whatever the team
            chose three releases ago. AINPI volunteered to analyse the gap and
            propose a recommendation.
          </p>
          <p className="text-gray-700 leading-relaxed">
            This survey is the input layer. Tell us what your team publishes
            today and what you wish was standardized. Anonymous responses are
            welcome; include an email only if you want a follow-up
            conversation.
          </p>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600">
            <a
              href="https://hl7.org/fhir/us/ndh/STU1/StructureDefinition-ndh-HealthcareService.html"
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white border rounded-md p-3 hover:border-primary-400"
            >
              <p className="font-mono text-primary-600 mb-1">NDH STU1 · HealthcareService profile →</p>
              <p>Reference for must-support fields below. (NDH IG v1.0.0 — STU1.)</p>
            </a>
            <a
              href="https://hl7.org/fhir/us/ndh/STU1/ValueSet-HealthcareServiceCategoryVS.html"
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white border rounded-md p-3 hover:border-primary-400"
            >
              <p className="font-mono text-primary-600 mb-1">NDH STU1 · HealthcareServiceCategoryVS →</p>
              <p>The 15 codes the form asks about.</p>
            </a>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Tracking{' '}
            <a
              href="https://build.fhir.org/ig/HL7/fhir-us-ndh/"
              className="text-primary-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              the STU2 CI build
            </a>{' '}
            for upcoming changes; survey responses inform the STU1 → STU2 transition.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-10">
          {/* Identity */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Who you are</h2>
            <p className="text-sm text-gray-600 mb-4">
              Optional unless you want a follow-up. We never publish anything
              tied to your identity.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Email</span>
                <input
                  type="email"
                  inputMode="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                  placeholder="you@example.com"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Organization</span>
                <input
                  type="text"
                  value={form.organization}
                  onChange={(e) => setForm({ ...form, organization: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Role</span>
                <select
                  value={form.roleType}
                  onChange={(e) => setForm({ ...form, roleType: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  <option value="">Select your role…</option>
                  {HCS_ROLE_TYPES.map((r) => (
                    <option key={r.code} value={r.code}>{r.display}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* Categories used */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              HealthcareServiceCategoryVS — what you publish today
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Check every category your team publishes a HealthcareService resource for.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {HCS_CATEGORIES.map((c) => (
                <label key={c.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.categoriesUsed.has(c.code)}
                    onChange={() =>
                      setForm({ ...form, categoriesUsed: toggle(form.categoriesUsed, c.code) })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                  />
                  <span><span className="font-mono text-xs text-gray-500 mr-1.5">{c.code}</span>{c.display}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Categories pain */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Which categories cause the most rework?
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Same 15 codes — flag the ones where you constantly fight upstream
              data quality, ambiguous mapping, or downstream consumer complaints.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {HCS_CATEGORIES.map((c) => (
                <label key={c.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.categoriesPain.has(c.code)}
                    onChange={() =>
                      setForm({ ...form, categoriesPain: toggle(form.categoriesPain, c.code) })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-400"
                  />
                  <span><span className="font-mono text-xs text-gray-500 mr-1.5">{c.code}</span>{c.display}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Must-support */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              NDH must-support — what you actually populate
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              The NDH HealthcareService profile flags these as must-support.
              Check every one you reliably populate today.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {HCS_MUST_SUPPORT_FIELDS.map((c) => (
                <label key={c.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.mustSupportFields.has(c.code)}
                    onChange={() =>
                      setForm({ ...form, mustSupportFields: toggle(form.mustSupportFields, c.code) })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                  />
                  <span>
                    <span className="font-mono text-xs text-gray-500 mr-1.5">{c.code}</span>
                    {c.display}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Profile + identifier + cadence */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Profile, identifier system, cadence
            </h2>
            <div className="grid grid-cols-1 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  Primary FHIR profile your HealthcareService conforms to
                </span>
                <select
                  value={form.fhirProfile}
                  onChange={(e) => setForm({ ...form, fhirProfile: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="">Select…</option>
                  {HCS_FHIR_PROFILES.map((p) => (
                    <option key={p.code} value={p.code}>{p.display}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  HealthcareService identifier system (URL or OID)
                </span>
                <input
                  type="text"
                  value={form.identifierSystem}
                  onChange={(e) => setForm({ ...form, identifierSystem: e.target.value })}
                  placeholder="e.g. https://example.com/fhir/sid/hcs-id"
                  className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                />
                <span className="block text-xs text-gray-500 mt-1">
                  We&apos;ll publish the distribution of values to expose collisions / convergence opportunities.
                </span>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  Publishing cadence
                </span>
                <select
                  value={form.publishCadence}
                  onChange={(e) => setForm({ ...form, publishCadence: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="">Select…</option>
                  {HCS_CADENCES.map((c) => (
                    <option key={c.code} value={c.code}>{c.display}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* Upstream sources */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Upstream sources you ingest for HealthcareService data
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Check every source you currently consume to populate this resource.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {HCS_UPSTREAM_SOURCES.map((s) => (
                <label key={s.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.consumerOf.has(s.code)}
                    onChange={() =>
                      setForm({ ...form, consumerOf: toggle(form.consumerOf, s.code) })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-400"
                  />
                  <span>{s.display}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Pain + recommendations */}
          <section className="bg-white border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              What hurts + what you&apos;d standardize
            </h2>
            <label className="block mb-4">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Pain points
              </span>
              <textarea
                value={form.painPoints}
                onChange={(e) => setForm({ ...form, painPoints: e.target.value })}
                rows={5}
                placeholder="What breaks for you today — fields that arrive empty, codes that mean different things across sources, downstream complaints, etc."
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                maxLength={4000}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Your recommendation
              </span>
              <textarea
                value={form.recommendations}
                onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
                rows={5}
                placeholder="If AINPI is going to recommend one thing to the NPD weekly group, what should it be? Concrete fields, codes, conformance rules, validation hooks, etc."
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                maxLength={4000}
              />
            </label>
          </section>

          {/* Follow-up */}
          <section className="bg-white border rounded-lg p-6">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.wantsFollowUp}
                onChange={(e) => setForm({ ...form, wantsFollowUp: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-400"
              />
              <span>
                <span className="font-medium text-gray-900">I&apos;m open to a 30-minute follow-up call.</span>{' '}
                <span className="text-gray-600">Requires an email above. We won&apos;t spam you; one outreach max.</span>
              </span>
            </label>
          </section>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : 'Submit response'}
            </button>
            <a
              href="/payer-healthcare-service-survey/results"
              className="text-sm text-primary-600 hover:underline"
            >
              View running aggregate →
            </a>
          </div>
        </form>
      </main>
      <Footer />
    </div>
  );
}
