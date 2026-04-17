#!/usr/bin/env npx tsx
/**
 * CMS National Provider Directory Ingestion Pipeline
 *
 * Stores full FHIR resource as JSON + extracted flat fields for querying.
 * Parses FHIR references (e.g. "Practitioner/Practitioner-1234567890") to extract IDs.
 *
 * Usage:
 *   npx tsx scripts/ingest-cms-npd.ts
 *   npx tsx scripts/ingest-cms-npd.ts --resource Practitioner
 *   npx tsx scripts/ingest-cms-npd.ts --local ./data/cms-npd --sample 10000
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

// Parse FHIR reference "ResourceType/ResourceType-ID" -> "ID"
function refId(ref: { reference?: string } | undefined | null): string | null {
  if (!ref?.reference) return null;
  return ref.reference; // Keep full reference for JOINs
}

// Extract NPI from identifier array
function extractNpi(identifiers: Array<{ system?: string; value?: string }> | undefined): string | null {
  if (!identifiers) return null;
  const npi = identifiers.find(
    (id) => id.system === 'http://hl7.org/fhir/sid/us-npi' || id.system === 'http://terminology.hl7.org/NamingSystem/npi'
  );
  return npi?.value || null;
}

interface ResourceConfig {
  name: string;
  file: string;
  tableName: string;
  extractFields: (r: Record<string, unknown>) => Record<string, unknown>;
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
        _id: r.id as string,
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
      const practitioner = r.practitioner as { reference?: string } | undefined;
      const organization = r.organization as { reference?: string } | undefined;
      const locations = r.location as Array<{ reference?: string }> | undefined;
      return {
        _id: r.id as string,
        _practitioner_id: refId(practitioner),
        _org_id: refId(organization),
        _specialty_code: specialties?.[0]?.coding?.[0]?.code || null,
        _specialty_display: specialties?.[0]?.coding?.[0]?.display || null,
        _location_ids: locations ? locations.map(l => l.reference || '').filter(Boolean).join('|') : null,
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
        _id: r.id as string,
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
      const managingOrg = r.managingOrganization as { reference?: string } | undefined;
      return {
        _id: r.id as string,
        _name: (r.name as string) || null,
        _state: address?.state || null,
        _city: address?.city || null,
        _postal_code: address?.postalCode || null,
        _status: (r.status as string) || null,
        _managing_org_id: refId(managingOrg),
      };
    },
  },
  {
    name: 'Endpoint',
    file: 'Endpoint.ndjson.zst',
    tableName: 'endpoint',
    extractFields: (r) => {
      const connectionType = r.connectionType as { code?: string } | undefined;
      const managingOrg = r.managingOrganization as { reference?: string } | undefined;
      return {
        _id: r.id as string,
        _connection_type: connectionType?.code || null,
        _status: (r.status as string) || null,
        _address: (r.address as string) || null,
        _name: (r.name as string) || null,
        _managing_org_id: refId(managingOrg),
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
        _id: r.id as string,
        _org_id: refId(org),
        _participating_org_id: refId(participating),
        _active: r.active === true,
      };
    },
  },
];

function ensureZstd() {
  try { execSync('which zstd', { stdio: 'ignore' }); } catch {
    console.error('zstd not installed. Run: brew install zstd'); process.exit(1);
  }
}

async function processLines(
  config: ResourceConfig, bigquery: BigQuery,
  rl: ReturnType<typeof createInterface>, sampleSize?: number
) {
  const table = bigquery.dataset(DATASET_ID).table(config.tableName);
  let batch: Record<string, unknown>[] = [];
  let totalRows = 0;
  let errorCount = 0;

  for await (const line of rl) {
    if (sampleSize && totalRows >= sampleSize) break;
    if (!line.trim()) continue;
    try {
      const resource = JSON.parse(line);
      const extracted = config.extractFields(resource);
      batch.push({ resource: JSON.stringify(resource), ...extracted });
      totalRows++;
      if (batch.length >= BATCH_SIZE) {
        try { await table.insert(batch, { ignoreUnknownValues: true, skipInvalidRows: true }); }
        catch (err: unknown) { errorCount += (err as { errors?: unknown[] }).errors?.length || 1; }
        process.stdout.write('\r  ' + config.name + ': ' + totalRows.toLocaleString() + ' rows (' + errorCount + ' errors)');
        batch = [];
      }
    } catch { errorCount++; }
  }
  if (batch.length > 0) {
    try { await table.insert(batch, { ignoreUnknownValues: true, skipInvalidRows: true }); }
    catch (err: unknown) { errorCount += (err as { errors?: unknown[] }).errors?.length || 1; }
  }
  console.log('\n  ' + config.name + ': Done. ' + totalRows.toLocaleString() + ' total, ' + errorCount + ' errors.');
}

async function ingestResource(config: ResourceConfig, bigquery: BigQuery, options: { localDir?: string; sampleSize?: number }) {
  const dataDir = options.localDir || DATA_DIR;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, config.file);
  if (!existsSync(filePath)) {
    console.log('  Downloading ' + CMS_NPD_BASE_URL + '/' + config.file + '...');
    execSync('curl -L -o "' + filePath + '" "' + CMS_NPD_BASE_URL + '/' + config.file + '"', { stdio: 'inherit' });
  }
  console.log('\nIngesting ' + config.name + ' from ' + filePath + '...');
  const decompressor = spawn('zstdcat', [filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: decompressor.stdout!, crlfDelay: Infinity });
  await processLines(config, bigquery, rl, options.sampleSize);
  decompressor.kill();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { resource?: string; localDir?: string; sampleSize?: number } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resource' && args[i+1]) opts.resource = args[++i];
    else if (args[i] === '--local' && args[i+1]) opts.localDir = args[++i];
    else if (args[i] === '--sample' && args[i+1]) opts.sampleSize = parseInt(args[++i], 10);
  }
  return opts;
}

async function main() {
  ensureZstd();
  const opts = parseArgs();
  const bq = new BigQuery({ projectId: PROJECT_ID });
  console.log('CMS NPD Ingestion — Project: ' + PROJECT_ID + ', Dataset: ' + DATASET_ID);
  if (opts.sampleSize) console.log('Sample: ' + opts.sampleSize.toLocaleString() + ' per resource');

  const toIngest = opts.resource
    ? RESOURCES.filter(r => r.name.toLowerCase() === opts.resource!.toLowerCase())
    : RESOURCES;
  if (toIngest.length === 0) { console.error('Unknown resource: ' + opts.resource); process.exit(1); }

  for (const config of toIngest) await ingestResource(config, bq, opts);
  console.log('\nIngestion complete!');
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
