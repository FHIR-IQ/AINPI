import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';

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
  params?: Record<string, unknown>
): Promise<T[]> {
  const client = getBigQueryClient();
  const options: { query: string; params?: Record<string, unknown> } = { query: sql };
  if (params) options.params = params;
  const [rows] = await client.query(options);
  return rows as T[];
}
