import type { ConnectivityPayload } from '@/lib/connectivity-types';

type Systems = ConnectivityPayload['systems'];

export interface SystemsExclusionsNoteProps {
  excluded: Systems['excluded_third_party'];
  outOfState: Systems['out_of_state_endpoints_dropped'];
}

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/**
 * Plain-language note under the health-systems table: which names were kept
 * out of system grouping because they belong to a billing or staffing vendor,
 * and how many endpoints were dropped because only an out-of-state member
 * carried them. Both blocks are optional in the payload (older slices predate
 * them); with neither present the note renders nothing.
 */
export default function SystemsExclusionsNote({
  excluded,
  outOfState,
}: SystemsExclusionsNoteProps) {
  if (!excluded && !outOfState) return null;

  const vendorRows = excluded?.rows ?? [];
  const vendorOrgs = vendorRows.reduce((sum, r) => sum + r.organizations, 0);

  return (
    <div
      className="measure mt-4 space-y-2 text-sm text-gray-600"
      data-testid="systems-exclusions-note"
    >
      {excluded && (
        <p>
          <span className="font-medium text-ink">Not counted as systems. </span>
          {vendorRows.length === 0 ? (
            <>No billing, revenue-cycle or staffing vendor names were found to set aside in this state.</>
          ) : (
            <>
              {fmt(vendorOrgs)} {plural(vendorOrgs, 'organization carries', 'organizations carry')}{' '}
              the name of a billing or staffing company rather than their own
              owner&rsquo;s (
              {vendorRows
                .map((r) => `${r.label}, ${fmt(r.organizations)}`)
                .join('; ')}
              ). Grouping them by that name would merge unrelated practices,
              so each stays in the ledger as a standalone organization.
            </>
          )}
        </p>
      )}
      {outOfState && (
        <p>
          <span className="font-medium text-ink">Endpoints left out. </span>
          {outOfState.count === 0 ? (
            <>No system reached an endpoint only through a member in another state.</>
          ) : (
            <>
              <span className="font-mono">{fmt(outOfState.count)}</span>{' '}
              {plural(outOfState.count, 'web address was', 'web addresses were')}{' '}
              dropped from the system totals above because the only member
              carrying {plural(outOfState.count, 'it', 'them')} is in another
              state.
            </>
          )}
          {outOfState.kept_from_members_without_state > 0 && (
            <>
              {' '}
              <span className="font-mono">
                {fmt(outOfState.kept_from_members_without_state)}
              </span>{' '}
              {plural(
                outOfState.kept_from_members_without_state,
                'link from a member with no recorded state was',
                'links from members with no recorded state were',
              )}{' '}
              kept, because they cannot be shown to be out of state.
            </>
          )}
        </p>
      )}
    </div>
  );
}
