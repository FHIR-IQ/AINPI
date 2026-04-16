import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * CMS NPD Data Quality API
 *
 * Serves pre-aggregated data quality metrics from Supabase.
 * Data is synced from BigQuery by the sync-bq-to-supabase script.
 *
 * GET /api/npd/data-quality                          - Full summary
 * GET /api/npd/data-quality?view=states              - State breakdown
 * GET /api/npd/data-quality?view=specialties         - Specialty breakdown
 * GET /api/npd/data-quality?view=endpoints           - Endpoint types
 * GET /api/npd/data-quality?view=state&state=CA      - Single state detail
 */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const view = url.searchParams.get('view') || 'summary';
    const releaseDate = url.searchParams.get('release') || '2026-04-09';

    switch (view) {
      case 'summary': {
        const summary = await prisma.npdDataQualitySummary.findMany({
          where: { releaseDate },
          orderBy: { resourceType: 'asc' },
        });

        const totalRecords = summary.reduce((sum, s) => sum + s.totalRecords, 0);
        const stateCount = await prisma.npdStateMetrics.count({
          where: { releaseDate },
        });
        const specialtyCount = await prisma.npdSpecialtyMetrics.count({
          where: { releaseDate },
        });

        return NextResponse.json({
          release_date: releaseDate,
          overview: {
            total_records: totalRecords,
            states_covered: stateCount,
            specialties_covered: specialtyCount,
          },
          resource_quality: summary.map((s) => ({
            resource_type: s.resourceType,
            total_records: s.totalRecords,
            active_records: s.activeRecords,
            completeness: {
              primary_id: s.idCompletenessPct,
              name: s.nameCompletenessPct,
              address: s.addressCompletenessPct,
            },
          })),
        });
      }

      case 'states': {
        const states = await prisma.npdStateMetrics.findMany({
          where: { releaseDate },
          orderBy: { providerCount: 'desc' },
        });

        return NextResponse.json({
          release_date: releaseDate,
          total_states: states.length,
          states: states.map((s) => ({
            state: s.state,
            providers: s.providerCount,
            organizations: s.orgCount,
            locations: s.locationCount,
            active_providers: s.activeProviders,
            npi_completeness: s.npiCompleteness,
            address_completeness: s.addressCompleteness,
          })),
        });
      }

      case 'state': {
        const state = url.searchParams.get('state')?.toUpperCase();
        if (!state) {
          return NextResponse.json({ error: 'state parameter required' }, { status: 400 });
        }

        const metrics = await prisma.npdStateMetrics.findUnique({
          where: { releaseDate_state: { releaseDate, state } },
        });

        if (!metrics) {
          return NextResponse.json({ error: `No data for state ${state}` }, { status: 404 });
        }

        return NextResponse.json({
          release_date: releaseDate,
          state: metrics.state,
          providers: metrics.providerCount,
          organizations: metrics.orgCount,
          locations: metrics.locationCount,
          endpoints: metrics.endpointCount,
          active_providers: metrics.activeProviders,
          npi_completeness: metrics.npiCompleteness,
          address_completeness: metrics.addressCompleteness,
        });
      }

      case 'specialties': {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
        const specialties = await prisma.npdSpecialtyMetrics.findMany({
          where: { releaseDate },
          orderBy: { providerCount: 'desc' },
          take: limit,
        });

        return NextResponse.json({
          release_date: releaseDate,
          total_specialties: specialties.length,
          specialties: specialties.map((s) => ({
            code: s.specialtyCode,
            display: s.specialtyDisplay,
            providers: s.providerCount,
            organizations: s.orgCount,
            top_states: s.topStates,
          })),
        });
      }

      case 'endpoints': {
        const endpoints = await prisma.npdEndpointMetrics.findMany({
          where: { releaseDate },
          orderBy: { endpointCount: 'desc' },
        });

        const totalEndpoints = endpoints.reduce((sum, e) => sum + e.endpointCount, 0);

        return NextResponse.json({
          release_date: releaseDate,
          total_endpoints: totalEndpoints,
          by_type: endpoints.map((e) => ({
            connection_type: e.connectionType,
            status: e.status,
            count: e.endpointCount,
            unique_organizations: e.uniqueOrgs,
          })),
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown view: ${view}. Use: summary, states, state, specialties, endpoints` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Data quality API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data quality metrics' },
      { status: 500 }
    );
  }
}
