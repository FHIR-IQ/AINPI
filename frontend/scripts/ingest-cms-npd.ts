#!/usr/bin/env npx tsx
/**
 * CMS National Provider Directory Ingestion Pipeline
 *
 * Downloads, decompresses (zstd), and streams NDJSON into BigQuery.
 * Also populates lean Supabase index tables for the web app.
 *
 * Usage:
 *   npx tsx scripts/ingest-cms-npd.ts                    # Full ingestion
 *   npx tsx scripts/ingest-cms-npd.ts --resource Practitioner
 *   npx tsx scripts/ingest-cms-npd.ts --local ./data     # From local files
 *   npx tsx scripts/ingest-cms-npd.ts --sample 10000     # First N records only
 */

import { BigQuery } from '@google-cloud/bigquery';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { execSync, spawn } from 'child_process';
import { Writable } from 'stream';
import path from 'path';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const DATA_DIR = process.env.CMS_NPD_DATA_DIR || path.join(process.cwd(), 'data', 'cms-npd');
const BATCH_SIZE = 5000; // Rows per BigQuery insert batch

const CMS_NPD_BASE_URL = 'https://directory.cms.gov/downloads';

interface ResourceConfig {
  name: string;
  file: string;
  tableName: string;
  extractFields: (resource: Record<string, unknown>) => Record<string, unknown>;
}

// Extract NPI from FHIR identifier array
function extractNpi(identifiers: Array<{ system?: string; value?: string }> | undefined): string | null {
  if (!identifiers) return null;
  const npiId = identifiers.find(
    (id) => id.system === 'http://hl7.org/fhir/sid/us-npi' || id.system === 'http://terminology.hl7.org/NamingSystem/npi'
  );
  return npiId?.value || null;
}

// Extract reference ID (e.g., "Practitioner/123" -> "123")
function extractRefId(ref: { reference?: string } | undefined): string | null {
  if (!ref?.reference) return null;
  const parts = ref.reference.split('/');
  return parts[parts.length - 1] || null;
}

const RESOURCES: ResourceConfig[] = [
  {
    name: 'Practitioner',
    file: 'Practitioner.ndjson.zst',
    tableName: 'practitioner',
    extractFields: (r) => {
      const names = r.name as Array<{ family?: string; given?: string[] }> | undefined;
      const addresses = r.address as Array<{ state?: string; city?: string; postalCode?: string }> | undefined;
      const identifiers = r.identifier as Array<{ system?: string; value?: string }> | undefined;
      return {
        _npi: extractNpi(identifiers),
        _family_name: names?.[0]?.family || null,
        _given_name: names?.[0]?.given?.[0] || null,
        _state: addresses?.[0]?.state || null,
        _city: addresses?.[0]?.city || null,
        _postal_code: addresses?.[0]?.postalCode || null,
      };
    },
  },
  {
    name: 'PractitionerRole',
    file: 'PractitionerRole.ndjson.zst',
    tableName: 'practitioner_role',
    extractFields: (r) => {
      const specialties = r.specialty as Array<{ coding?: Array<{ code?: string; display?: string }> }> | undefined;
      const practitioner = r.practitioner as { identifier?: { value?: string } } | undefined;
      const organization = r.organization as { identifier?: { value?: string } } | undefined;
      return {
        _practitioner_npi: practitioner?.identifier?.value || null,
        _org_npi: organization?.identifier?.value || null,
        _specialty_code: specialties?.[0]?.coding?.[0]?.code || null,
        _specialty_display: specialties?.[0]?.coding?.[0]?.display || null,
      };
    },
  },
  {
    name: 'Organization',
    file: 'Organization.ndjson.zst',
    tableName: 'organization',
    extractFields: (r) => {
      const identifiers = r.identifier as Array<{ system?: string; value?: string }> | undefined;
      const addresses = r.address as Array<{ state?: string; city?: string }> | undefined;
      const types = r.type as Array<{ coding?: Array<{ code?: string }> }> | undefined;
      return {
        _npi: extractNpi(identifiers),
        _state: addresses?.[0]?.state || null,
        _city: addresses?.[0]?.city || null,
        _org_type: types?.[0]?.coding?.[0]?.code || null,
      };
    },
  },
  {
    name: 'Location',
    file: 'Location.ndjson.zst',
    tableName: 'location',
    extractFields: (r) => {
      const address = r.address as { state?: string; city?: string; postalCode?: string } | undefined;
      const managingOrg = r.managingOrganization as { identifier?: { value?: string } } | undefined;
      return {
        _state: address?.state || null,
        _city: address?.city || null,
        _postal_code: address?.postalCode || null,
        _managing_org_npi: managingOrg?.identifier?.value || null,
      };
    },
  },
  {
    name: 'Endpoint',
    file: 'Endpoint.ndjson.zst',
    tableName: 'endpoint',
    extractFields: (r) => {
      const connectionType = r.connectionType as { code?: string } | undefined;
      const managingOrg = r.managingOrganization as { display?: string } | undefined;
      const mimeTypes = r.payloadMimeType as string[] | undefined;
      return {
        _connection_type_code: connectionType?.code || null,
        _managing_org_name: managingOrg?.display || null,
        _mime_types: mimeTypes?.join(',') || null,
      };
    },
  },
  {
    name: 'OrganizationAffiliation',
    file: 'OrganizationAffiliation.ndjson.zst',
    tableName: 'organization_affiliation',
    extractFields: (r) => {
      const org = r.organization as { identifier?: { value?: string } } | undefined;
      const participating = r.participatingOrganization as { identifier?: { value?: string } } | undefined;
      return {
        _org_npi: org?.identifier?.value || null,
        _participating_org_npi: participating?.identifier?.value || null,
      };
    },
  },
];

// Check if zstd is available
function ensureZstd() {
  try {
    execSync('which zstd', { stdio: 'ignore' });
  } catch {
    console.error('zstd is not installed. Install it:');
    console.error('  macOS:        brew install zstd');
    console.error('  Debian/Ubuntu: apt install zstd');
    console.error('  Windows:      winget install Facebook.Zstandard');
    process.exit(1);
  }
}

// Download a file from CMS NPD
async function downloadFile(filename: string, destDir: string): Promise<string> {
  const destPath = path.join(destDir, filename);
  if (existsSync(destPath)) {
    console.log(`  File exists: ${destPath}`);
    return destPath;
  }

  const url = `${CMS_NPD_BASE_URL}/${filename}`;
  console.log(`  Downloading ${url}...`);

  // Use curl for large file downloads with progress
  execSync(`curl -L -o "${destPath}" "${url}"`, { stdio: 'inherit' });
  return destPath;
}

// Stream decompress and parse NDJSON
function createDecompressStream(filePath: string): ReturnType<typeof spawn> {
  return spawn('zstdcat', [filePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Process a resource type: decompress -> parse -> batch insert into BigQuery
async function ingestResource(
  config: ResourceConfig,
  bigquery: BigQuery,
  options: { localDir?: string; sampleSize?: number }
) {
  const { localDir, sampleSize } = options;
  const dataDir = localDir || DATA_DIR;

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, config.file);

  // Download if not local
  if (!existsSync(filePath)) {
    if (localDir) {
      // Check for uncompressed file
      const uncompressed = filePath.replace('.zst', '');
      if (existsSync(uncompressed)) {
        console.log(`  Using uncompressed file: ${uncompressed}`);
        return ingestFromUncompressed(config, bigquery, uncompressed, sampleSize);
      }
      console.error(`  File not found: ${filePath}`);
      return;
    }
    await downloadFile(config.file, dataDir);
  }

  console.log(`\nIngesting ${config.name} from ${filePath}...`);

  const decompressor = createDecompressStream(filePath);
  const rl = createInterface({ input: decompressor.stdout!, crlfDelay: Infinity });

  await processLines(config, bigquery, rl, sampleSize);

  decompressor.kill();
}

async function ingestFromUncompressed(
  config: ResourceConfig,
  bigquery: BigQuery,
  filePath: string,
  sampleSize?: number
) {
  console.log(`\nIngesting ${config.name} from ${filePath}...`);
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  await processLines(config, bigquery, rl, sampleSize);
}

async function processLines(
  config: ResourceConfig,
  bigquery: BigQuery,
  rl: ReturnType<typeof createInterface>,
  sampleSize?: number
) {
  const dataset = bigquery.dataset(DATASET_ID);
  const table = dataset.table(config.tableName);

  let batch: Record<string, unknown>[] = [];
  let totalRows = 0;
  let errorCount = 0;

  for await (const line of rl) {
    if (sampleSize && totalRows >= sampleSize) break;
    if (!line.trim()) continue;

    try {
      const resource = JSON.parse(line);
      const extracted = config.extractFields(resource);

      // Merge extracted fields with the raw resource
      // Store complex fields as JSON strings for BigQuery JSON type
      const row: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(resource)) {
        if (typeof value === 'object' && value !== null) {
          row[key] = JSON.stringify(value);
        } else {
          row[key] = value;
        }
      }
      Object.assign(row, extracted);

      batch.push(row);
      totalRows++;

      if (batch.length >= BATCH_SIZE) {
        try {
          await table.insert(batch, { ignoreUnknownValues: true, skipInvalidRows: true });
        } catch (err: unknown) {
          const bqErr = err as { errors?: unknown[] };
          errorCount += bqErr.errors?.length || 1;
        }
        process.stdout.write(`\r  ${config.name}: ${totalRows.toLocaleString()} rows ingested (${errorCount} errors)`);
        batch = [];
      }
    } catch {
      errorCount++;
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    try {
      await table.insert(batch, { ignoreUnknownValues: true, skipInvalidRows: true });
    } catch (err: unknown) {
      const bqErr = err as { errors?: unknown[] };
      errorCount += bqErr.errors?.length || 1;
    }
  }

  console.log(`\n  ${config.name}: Done. ${totalRows.toLocaleString()} total rows, ${errorCount} errors.`);
}

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const options: { resource?: string; localDir?: string; sampleSize?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resource' && args[i + 1]) {
      options.resource = args[++i];
    } else if (args[i] === '--local' && args[i + 1]) {
      options.localDir = args[++i];
    } else if (args[i] === '--sample' && args[i + 1]) {
      options.sampleSize = parseInt(args[++i], 10);
    }
  }

  return options;
}

async function main() {
  ensureZstd();

  const options = parseArgs();
  const bigquery = new BigQuery({ projectId: PROJECT_ID });

  console.log('CMS National Provider Directory Ingestion');
  console.log(`Project: ${PROJECT_ID}, Dataset: ${DATASET_ID}`);
  if (options.sampleSize) console.log(`Sample mode: first ${options.sampleSize.toLocaleString()} records per resource`);
  if (options.localDir) console.log(`Local directory: ${options.localDir}`);
  console.log();

  const resourcesToIngest = options.resource
    ? RESOURCES.filter((r) => r.name.toLowerCase() === options.resource!.toLowerCase())
    : RESOURCES;

  if (resourcesToIngest.length === 0) {
    console.error(`Unknown resource: ${options.resource}`);
    console.error(`Available: ${RESOURCES.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }

  for (const config of resourcesToIngest) {
    await ingestResource(config, bigquery, options);
  }

  console.log('\nIngestion complete!');
  console.log('Run the data quality dashboard to see metrics: npm run dev -> /data-quality');
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
