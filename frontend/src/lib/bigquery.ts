import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';

/**
 * Per-query maximum bytes billed cap. 100 GB ≈ $0.50 per query at on-demand
 * pricing ($5 per TB). Any query that would scan more than this errors out
 * instead of running — protects against runaway costs from accidental
 * full-table scans on the 21.7M-record NDH dataset. Current production
 * queries scan well under 25 GB; this cap has 4× headroom.
 *
 * Override per-query via the `maximumBytesBilled` option on `queryBigQuery`
 * if a legitimate larger query is needed.
 */
export const DEFAULT_MAX_BYTES_BILLED = 100_000_000_000; // 100 GB

let bigqueryClient: BigQuery | null = null;

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

    bigqueryClient = new BigQuery(options);
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
