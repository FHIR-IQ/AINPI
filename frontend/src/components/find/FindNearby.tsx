'use client';

import { useState } from 'react';

interface Result {
  location_id: string;
  name: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number;
  organization_name: string | null;
  organization_npi: string | null;
  organization_resolved: boolean;
}

interface Response {
  centre: { lat: number; lng: number; resolved_from: string | null };
  radius_km: number;
  total_results: number;
  truncated: boolean;
  data: Result[];
  error?: string;
  message?: string;
}

const RADII = [5, 8, 16, 40, 80];

/**
 * ZIP or browser-geolocation search over the directory's own coordinates.
 *
 * No mapping API is involved. The directory publishes coordinates on 98.28% of
 * its location records, the browser knows where the user is if they say so, and
 * the Census publishes an official centre for every ZCTA. Between them there is
 * nothing left for a paid geocoder to do at this level of precision, and adding
 * one would put a per-request cost on the most public page here.
 */
export default function FindNearby() {
  const [zip, setZip] = useState('');
  const [radius, setRadius] = useState(8);
  const [res, setRes] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(params: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/npd/geo-search?${params}&radius_km=${radius}`);
      const body: Response = await r.json();
      if (!r.ok) {
        // 429 is a rate limit, and telling someone "search failed" when the
        // real answer is "wait a minute" sends them away for good.
        setError(
          r.status === 429
            ? 'Too many searches from this address just now. Wait a minute and try again.'
            : body.message || body.error || 'Search failed.',
        );
        setRes(null);
        return;
      }
      setRes(body);
    } catch {
      setError('Could not reach the search service.');
      setRes(null);
    } finally {
      setLoading(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot share a location. Enter a ZIP instead.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setZip('');
        void run(`lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      },
      () => {
        setLoading(false);
        setError('Location permission denied. Enter a ZIP instead.');
      },
      { timeout: 10_000 },
    );
  }

  return (
    <section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{5}$/.test(zip)) void run(`zip=${zip}`);
          else setError('Enter a five-digit ZIP code.');
        }}
        className="flex flex-wrap items-end gap-3 mb-6"
      >
        <label className="text-xs text-gray-600">
          <span className="block mb-1 uppercase tracking-wide">ZIP code</span>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            placeholder="15213"
            aria-label="ZIP code"
            className="border border-gray-300 bg-white px-3 py-2 text-sm w-28 font-mono"
          />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1 uppercase tracking-wide">Within</span>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="border border-gray-300 bg-white px-2 py-2 text-sm"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="border border-primary-600 bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={loading}
          className="border border-gray-400 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Use my location
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-signal mb-6">
          {error}
        </p>
      )}

      {res && (
        <>
          <p className="text-sm text-gray-700 mb-4">
            {res.total_results === 0 ? (
              <>
                Nothing listed within {res.radius_km} km. Try a wider radius: an
                empty result means the directory lists nothing here, which is
                itself worth knowing.
              </>
            ) : (
              <>
                <strong>{res.total_results}</strong> location
                {res.total_results === 1 ? '' : 's'} within {res.radius_km} km
                {res.truncated && ', showing the closest 100'}.
              </>
            )}
          </p>

          <ul className="space-y-3">
            {res.data.map((r) => (
              <li
                key={r.location_id}
                className="border border-gray-300 p-4 flex flex-wrap gap-x-6 gap-y-2 justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {r.name || '(no name in the directory)'}
                  </p>
                  <p className="text-xs text-gray-600">
                    {[r.address_line, r.city, r.state, r.postal_code]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  <p className="text-xs mt-1">
                    {r.organization_resolved ? (
                      <span className="text-gray-700">
                        Run by {r.organization_name}
                        {r.organization_npi && (
                          <span className="text-gray-500 font-mono">
                            {' '}
                            NPI {r.organization_npi}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-signal">
                        Owner not listed in the directory
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="stat text-lg text-ink tabular-nums">
                    {r.distance_km} km
                  </p>
                  {r.phone && (
                    <a
                      href={`tel:${r.phone}`}
                      className="text-xs text-primary-600 hover:underline font-mono"
                    >
                      {r.phone}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
