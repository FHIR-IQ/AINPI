#!/usr/bin/env npx tsx
/**
 * CMS National Provider Directory Ingestion Pipeline
 *
 * Downloads, decompresses (zstd), and streams NDJSON into BigQuery.
 * Stores the full FHIR resource as a JSON column + extracted flat fields for querying.
 *
 * Usage:
 *   npx tsx scripts/ingest-cms-npd.ts                       # Full ingestion
 *   npx tsx scripts/ingest-cms-npd.ts --resource Practitioner
 *   npx tsx scripts/ingest-cms-npd.ts --local ./data/cms-npd
 *   npx tsx scripts/ingest-cms-npd.ts --sample 10000
 */

import { BigQuery } from '@google-cloud/bigquery';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { execSync, spawn } from 'child_process';
import path from 'path';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'thematic-fort-453901-t7';
const DATASET_ID = process.env.BQ_DATASET_ID || 'cms_npd';
const DATA_DIR = process.env.CMS_NPD_DATA_DIR || path.join(process.cwd(), 'data', 'cms-npd');
const BATCH_SIZE = 2000;
const CMS_NPD_BASE_URL = 'https://directory.cms.gov/downloads';

interface ResourceConfig {
  name: string;
  file: string;
  tableName: string;
  extractFields: (resource: Record<string, unknown>) => Record<string, unknown>;
}

function extractNpi(identifiers: Array<{ system?: string; value?: string }> | undefined): string | null {
  if (!identifiers) return null;
  const npiId = identifiers.find(
    (id) => id.system === 'http://hl7.org/fhir/sid/us-npi' || id.system === 'http://terminology.hl7.org/NamingSystem/npi'
  );
  return npiId?.value || null;
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
        _gender: (r.gender as string) || null,
        _active: r.active === true,
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
        _active: r.active === true,
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
        _name: (r.name as string) || null,
        _state: addresses?.[0]?.state || null,
        _city: addresses?.[0]?.city || null,
        _org_type: types?.[0]?.coding?.[0]?.code || null,
        _active: r.active === true,
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
        _name: (r.name as string) || null,
        _status: (r.status as string) || null,
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
      return {
        _connection_type_code: connectionType?.code || null,
        _status: (r.status as string) || null,
        _address: (r.address as string) || null,
        _name: (r.name as string) || null,
        _managing_org_name: managingOrg?.display || null,
      };
    },
  },
  {
    name: 'OrganizationAffiliation',
    file: 'OrganizationAffiliation.ndjson.zst',
    tableName: 'organization_affiliation',
    extractFields: (r) => {
      const org = r.organization as { reference?: string } | undefined;
      const participating = r.participatingOrganization as { reference?: string } | undefined;
      return {
        _org_ref: org?.reference || null,
        _participating_org_ref: participating?.reference || null,
        _active: r.active === true,
      };
    },
  },
];

function ensureZstd() {
  try {
    execSync('which zstd', { stdio: 'ignore' });
  } catch {
    console.error('zstd not installed. Run: brew install zstd');
    process.exit(1);
  }
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

      // Store full resource as JSON string + flat extracted fields
      const row: Record<string, unknown> = {
        resource: JSON.stringify(resource),
        ...extracted,
      };

      batch.push(row);
      totalRows++;

      if (batch.length >= BATCH_SIZE) {
        try {
          await table.insert(batch, { ignoreUnknownValues: true, skipInvalidRows: true });
        } catch (err: unknown) {
          const bqErr = err as { errors?: unknown[] };
          errorCount += bqErr.errors?.length || 1;
        }
        process.stdout.write(`\r  ${config.name}: ${totalRows.toLocaleString()} rows (${errorCount} errors)`);
        batch = [];
      }
    } catch {
      errorCount++;
    }
  }

  if (batch.length > 0) {
    try {
      await table.insert(batch, { ignoreUnknownValues: true, skipInvalidRows: true });
    } catch (err: unknown) {
      const bqErr = err as { errors?: unknown[] };
      errorCount += bqErr.errors?.length || 1;
    }
  }

  console.log(`\n  ${config.name}: Done. ${totalRows.toLocaleString()} total, ${errorCount} errors.`);
}

async function ingestResource(
  config: ResourceConfig,
  bigquery: BigQuery,
  options: { localDir?: string; sampleSize?: number }
) {
  const dataDir = options.localDir || DATA_DIR;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const filePath = path.join(dataDir, config.file);

  if (!existsSync(filePath)) {
    const uncompressed = filePath.replace('.zst', '');
    if (existsSync(uncompressed)) {
      console.log(`\nIngesting ${config.name} from ${uncompressed}...`);
      const stream = createReadStream(uncompressed, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      await processLines(config, bigquery, rl, options.sampleSize);
      return;
    }
    // Download
    const url = `${CMS_NPD_BASE_URL}/${config.file}`;
    console.log(`  Downloading ${url}...`);
    execSync(`curl -L -o "${filePath}" "${url}"`, { stdio: 'inherit' });
  }

  console.log(`\nIngesting ${config.name} from ${filePath}...`);
  const decompressor = spawn('zstdcat', [filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: decompressor.stdout!, crlfDelay: Infinity });
  await processLines(config, bigquery, rl, options.sampleSize);
  decompressor.kill();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: { resource?: string; localDir?: string; sampleSize?: number } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resource' && args[i + 1]) options.resource = args[++i];
    else if (args[i] === '--local' && args[i + 1]) options.localDir = args[++i];
    else if (args[i] === '--sample' && args[i + 1]) options.sampleSize = parseInt(args[++i], 10);
  }
  return options;
}

async function main() {
  ensureZstd();
  const options = parseArgs();
  const bigquery = new BigQuery({ projectId: PROJECT_ID });

  console.log('CMS National Provider Directory Ingestion');
  console.log(`Project: ${PROJECT_ID}, Dataset: ${DATASET_ID}`);
  if (options.sampleSize) console.log(`Sample: first ${options.sampleSize.toLocaleString()} per resource`);
  console.log();

  const toIngest = options.resource
    ? RESOURCES.filter((r) => r.name.toLowerCase() === options.resource!.toLowerCase())
    : RESOURCES;

  if (toIngest.length === 0) {
    console.error(`Unknown resource: ${options.resource}`);
    process.exit(1);
  }

  for (const config of toIngest) {
    await ingestResource(config, bigquery, options);
  }

  console.log('\nIngestion complete!');
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
