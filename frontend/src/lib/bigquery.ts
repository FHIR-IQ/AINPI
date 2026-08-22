import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';

/**
 * Per-query maximum bytes billed cap. 100 GB ≈ $0.50 per query at on-demand
 * pricing ($5 per TB). Any query that would scan more than this errors out
 * instead of running: protects against runaway costs from accidental
 * full-table scans on the 21.7M-record NDH dataset. Current production
 * queries scan well under 25 GB; this cap has 4× headroom.
 *
 * The cap is injected by `getBigQueryClient()` itself, so a route cannot
 * run an uncapped query by forgetting to pass it.
 *
 * Override per-query via the `maximumBytesBilled` option on `queryBigQuery`
 * if a legitimate larger query is needed.
 */
export const DEFAULT_MAX_BYTES_BILLED = 100_000_000_000; // 100 GB

let bigqueryClient: BigQuery | null = null;

/**
 * Returns a client whose `query()` ALWAYS carries a byte cap.
 *
 * This used to hand back the raw client. Every production route then called
 * `client.query({ query, params })` with no `maximumBytesBilled`, so the
 * documented "every BigQuery query defaults to 100 GB" was true of the Python
 * analysis scripts and false of the entire API surface. Seven routes, none
 * capped, all reachable without credentials.
 *
 * The CI anti-pattern rules did not catch it: Rule 3 checks Python, and
 * Rule 4 looks for `new BigQuery(` outside this file, which these routes did
 * not do. They went through the front door and the front door was open.
 *
 * Rather than fix seven call sites and rely on the eighth being written
 * correctly, the cap is injected here. A caller that passes its own
 * `maximumBytesBilled` keeps it, so a deliberate larger query is still
 * possible and still explicit.
 */
export function getBigQueryClient(): BigQuery {
  if (!bigqueryClient) {
    const options: Record<string, unknown> = { projectId: PROJECT_ID };

    // In production (Vercel), use service account key from env var
    const keyJson = process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (keyJson) {
      const credentials = JSON.parse(keyJson);
      options.credentials = credentials;
    }
    // Locally, falls back to Application Default Credentials (ADC)

    const raw = new BigQuery(options);
    const rawQuery = raw.query.bind(raw);

    // The BigQuery client's `query` is heavily overloaded, so the shim is
    // typed loosely at the boundary and the real signature is restored on the
    // way out. The only behaviour added is the cap.
    type Loose = (...args: unknown[]) => unknown;
    const passthrough = rawQuery as unknown as Loose;
    const shim: Loose = (...args: unknown[]) => {
      const [opts, ...rest] = args;
      if (typeof opts === 'string') {
        return passthrough(
          { query: opts, maximumBytesBilled: String(DEFAULT_MAX_BYTES_BILLED) },
          ...rest,
        );
      }
      if (opts && typeof opts === 'object') {
        const o = opts as Record<string, unknown>;
        if (o.maximumBytesBilled == null) {
          return passthrough(
            { ...o, maximumBytesBilled: String(DEFAULT_MAX_BYTES_BILLED) },
            ...rest,
          );
        }
      }
      return passthrough(...args);
    };
    (raw as unknown as { query: Loose }).query = shim;

    bigqueryClient = raw;
  }
  return bigqueryClient;
}

export function getDatasetId(): string {
  return DATASET_ID;
}

export function getProjectId(): string {
  return PROJECT_ID;
}

export async function queryBigQuery<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
  opts?: { maximumBytesBilled?: number }
): Promise<T[]> {
  const client = getBigQueryClient();
  const options: {
    query: string;
    params?: Record<string, unknown>;
    maximumBytesBilled: string;
  } = {
    query: sql,
    maximumBytesBilled: String(opts?.maximumBytesBilled ?? DEFAULT_MAX_BYTES_BILLED),
  };
  if (params) options.params = params;
  const [rows] = await client.query(options);
  return rows as T[];
}
