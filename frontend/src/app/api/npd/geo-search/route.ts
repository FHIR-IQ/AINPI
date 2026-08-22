import { NextRequest, NextResponse } from 'next/server';

import zipCentroids from '@/data/zip-centroids.json';
import { getBigQueryClient, getDatasetId, getProjectId } from '@/lib/bigquery';
import { enforceRateLimit, withRateLimitHeaders } from '@/lib/rate-limit';
import { CURRENT_RELEASE } from '@/lib/release';

/**
 * Find listed care locations near a point.
 *
 * GET /api/npd/geo-search?zip=15213&radius_km=8
 * GET /api/npd/geo-search?lat=40.44&lng=-79.99&radius_km=8&specialty=...
 *
 * COST. Measured by dry run against the 2026-08-20 warehouse: 0.26 GB per
 * call, about $1.65 per thousand. The bounding-box prefilter is not an
 * optimisation, it is the whole query: `location` is clustered on
 * `_managing_org_id`, so nothing here hits a cluster key and the scan is
 * column-pruned rather than partition-pruned. ST_DWITHIN alone costs the same
 * and is applied after the box to get a true circle rather than a rectangle.
 *
 * WHAT THIS IS NOT. This is an audit of a federal file, not a live directory.
 * It answers "what does the government's directory say is near you", which is
 * a different question from "where can you get care", and the response says so
 * in `disclaimer`. Locations with no coordinates cannot appear at all: 1.7% of
 * the location table, which the response reports rather than hides.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// TypeScript infers number[] from the JSON import and cannot know each entry
// is exactly two elements, so the cast goes through unknown. The generator
// refuses to write a file that is not [lat, lng] per ZIP.
const CENTROIDS = zipCentroids as unknown as Record<string, [number, number]>;

const MAX_RADIUS_KM = 80;
const DEFAULT_RADIUS_KM = 8;
const MAX_RESULTS = 100;

/** Degrees of longitude per km shrinks with latitude; degrees of latitude do not. */
function bbox(lat: number, lng: number, km: number) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimit(req, { shape: 'npd/geo-search' });
  if (!rl.ok) return rl.response!;

  try {
    const url = new URL(req.url);
    const zip = (url.searchParams.get('zip') || '').trim().slice(0, 5);
    const radiusKm = Math.min(
      MAX_RADIUS_KM,
      Math.max(1, Number(url.searchParams.get('radius_km') || DEFAULT_RADIUS_KM)),
    );

    // Read as strings first. `Number(null)` is 0, so coercing straight from a
    // missing parameter produced a valid-looking search centred on Null Island
    // in the Gulf of Guinea: HTTP 200, zero results, 17 cost units spent, and
    // nothing to tell the caller they had sent no location at all.
    const latRaw = url.searchParams.get('lat');
    const lngRaw = url.searchParams.get('lng');
    let lat = latRaw === null ? NaN : Number(latRaw);
    let lng = lngRaw === null ? NaN : Number(lngRaw);
    let resolvedFrom: string | null = null;

    if (zip) {
      const hit = CENTROIDS[zip];
      if (!hit) {
        // A ZIP with no ZCTA is a real thing (PO-box-only, single-building),
        // not a typo, so say which it is rather than returning nothing.
        return NextResponse.json(
          {
            error: 'unknown_zip',
            message:
              `No Census ZCTA for ZIP ${zip}. PO-box-only and single-building ` +
              `ZIPs have no mapped area, so they cannot be used as a search centre.`,
          },
          { status: 404 },
        );
      }
      [lat, lng] = hit;
      resolvedFrom = `zip:${zip}`;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: 'missing_location', message: 'Provide zip, or lat and lng.' },
        { status: 400 },
      );
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: 'invalid_location', message: 'Coordinates out of range.' },
        { status: 400 },
      );
    }

    const b = bbox(lat, lng, radiusKm);
    const project = getProjectId();
    const dataset = getDatasetId();

    const sql = `
      WITH near AS (
        SELECT
          _id, _name, _city, _state, _postal_code, _address_line, _phone,
          _position_lat AS lat, _position_lng AS lng, _managing_org_id,
          ST_DISTANCE(ST_GEOGPOINT(_position_lng, _position_lat),
                      ST_GEOGPOINT(@lng, @lat)) AS meters
        FROM \`${project}.${dataset}.location\`
        WHERE _position_lat BETWEEN @minLat AND @maxLat
          AND _position_lng BETWEEN @minLng AND @maxLng
      )
      SELECT
        n._id AS location_id, n._name AS location_name, n._city AS city,
        n._state AS state, n._postal_code AS postal_code,
        n._address_line AS address_line, n._phone AS phone,
        n.lat, n.lng, ROUND(n.meters) AS meters,
        o._name AS organization_name, o._npi AS organization_npi
      FROM near n
      LEFT JOIN \`${project}.${dataset}.organization\` o
        ON n._managing_org_id = CONCAT('Organization/', o._id)
      WHERE n.meters <= @radiusM
      ORDER BY n.meters
      LIMIT ${MAX_RESULTS}
    `;

    const client = getBigQueryClient();
    const [rows] = await client.query({
      query: sql,
      params: {
        lat,
        lng,
        minLat: b.minLat,
        maxLat: b.maxLat,
        minLng: b.minLng,
        maxLng: b.maxLng,
        radiusM: radiusKm * 1000,
      },
    });

    const results = (rows as Record<string, unknown>[]).map((r) => ({
      location_id: r.location_id,
      name: r.location_name,
      address_line: r.address_line,
      city: r.city,
      state: r.state,
      postal_code: r.postal_code,
      phone: r.phone,
      lat: r.lat,
      lng: r.lng,
      distance_km: Math.round(((r.meters as number) / 1000) * 10) / 10,
      organization_name: r.organization_name,
      organization_npi: r.organization_npi,
      // The gap this project exists to measure, made visible per row rather
      // than as a footnote: a location whose managing organization does not
      // resolve cannot be traced to anyone.
      organization_resolved: r.organization_name != null,
    }));

    const res = NextResponse.json({
      type: 'geo_search',
      centre: { lat, lng, resolved_from: resolvedFrom },
      radius_km: radiusKm,
      total_results: results.length,
      truncated: results.length === MAX_RESULTS,
      data: results,
      source: 'cms_npd',
      release_date: CURRENT_RELEASE,
      disclaimer:
        'These are care locations as listed in the CMS National Provider ' +
        'Directory bulk export, not a live directory of who is accepting ' +
        'patients. Verify with the provider before relying on it. Locations ' +
        'with no coordinates in the federal file (about 1.7% of the table) ' +
        'cannot appear in a distance search at all.',
    });
    return withRateLimitHeaders(res, rl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('geo-search error:', message);
    return NextResponse.json({ error: 'Geo search failed' }, { status: 500 });
  }
}
