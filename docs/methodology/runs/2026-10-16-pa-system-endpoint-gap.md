# Why the six largest PA systems show zero endpoints

Run date: 2026-10-16
Release: NDH 2026-10-07
Linear: FHI-19
Script: `analysis/pa_system_endpoint_gap.py`
Output: `frontend/public/api/v1/states/pa-system-endpoint-gap.json`
Cost: 2.05 GB billed in total; the four capped queries behind the published
payload are 1.76 GB of that (a first endpoint lookup by exact host, 0.28 GB,
was replaced by the domain lookup). The QA regeneration re-ran the same four
queries and hit BigQuery's result cache, so the payload's `bytes_billed` reads
0 with `bq_result_cache_hit: true`.

The output is pinned to `CURRENT_RELEASE` and must be regenerated alongside
the connectivity ledger at the next reload; its positive control refuses to
write against a ledger on another release.

## Question

The Pennsylvania connectivity ledger (`states/pa-connectivity.json`) lists
`endpoint_count: 0` for each of its six largest health systems. Is that because
the systems publish no FHIR endpoint, because the public record does not
connect the endpoint they publish to their clinicians, or because our method
misses a connection that exists?

## Short answer

The second and third happen; the first does not. Each of the six
publishes a FHIR endpoint in Epic's User-access Brands file, and the NDH itself
carries that endpoint for five of them. None of the six has a link that the
ledger's system rollup accepts (an NDH `managingOrganization` on a member, or
an NPI the vendor publishes for a member). Yet 13,755 of the systems' 21,963
distinct clinicians already reach an endpoint through a member organization or
CMS enrollment, the tiers the ledger's own practitioner funnel accepts and the
rollup does not. For Geisinger, St. Luke's and WellSpan that is every
clinician, and all but one at St. Luke's land on the system's own endpoint. The
13,755 is a lower bound on what the funnel credits these clinicians, because
the funnel also counts organizations outside the system.

So "the six largest systems show zero endpoints" is partly a defect in the
rollup. A defensible version of the claim is narrower: no deterministic link
in the public record (NDH reference or vendor-published NPI) connects these
systems' clinicians to the endpoint the system publishes.

## Which six

Taken from `systems.rows` in the payload, by the ledger's own count. The ledger
groups by name inference here, so UPMC appears three times (UNIVERSITY OF
PITTSBURGH, PINNACLE, and UPMC itself at 1,576 links, 25th), Penn Medicine and
Jefferson do not make the top six, and Penn State Health is split across MSHMC
and an NPPES parent group.

The ledger's `practitioners` column is a sum of practitioner-organization
links, not a count of clinicians. A clinician with roles at four UPP locations
counts four times. The six rows sum to 60,855 links and 21,963 distinct
clinicians. The "~50K clinicians" figure comes from that sum and should not be
quoted.

| System (ledger label) | Member orgs | Links | Distinct clinicians | Reach any endpoint | Of which the system's own domain | Via |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| UNIVERSITY OF PITTSBURGH (UPMC) | 34 | 17,882 | 6,793 | 725 (10.7%) | 86 | CMS enrollment |
| GEISINGER | 120 | 16,799 | 5,199 | 5,199 (100%) | 5,199 | H53 brand/name |
| ST LUKE | 257 | 8,651 | 3,029 | 3,029 (100%) | 3,028 | H53 brand/name (1 enrollment) |
| AHN | 59 | 6,472 | 3,215 | 2,723 (84.7%) | 2,673 | CMS enrollment |
| PINNACLE (UPMC Pinnacle) | 213 | 5,904 | 2,382 | 398 (16.7%) | 21 | CMS enrollment |
| WELLSPAN | 144 | 5,147 | 2,956 | 2,956 (100%) | 2,956 | H53 brand/name |

"Reach" here is through the clinician's member organizations or CMS
enrollment. Zero clinicians in any of the six reach an endpoint through the
NDH or a vendor-published NPI. For UPP and Pinnacle most enrollment-tier
reach lands on an endpoint other than UPMC's, so it says little about UPMC.

The six distinct counts sum to 23,574, more than the 21,963 union, because
clinicians hold roles in more than one system (434 in both AHN and UPP, 291 in
both Geisinger and St. Luke's). UPP and Pinnacle share 173, so the UPMC pair
holds 9,002 distinct. Every pair is in the payload's `pairwise_overlap`.

## Where the chain breaks

The same break appears in all six. The member organizations, the legal
entities that hold the clinicians' `PractitionerRole`s, carry no reference to
the system's endpoint, no `Organization.partOf`, and no NPI that the vendor
publishes. What varies is where the endpoint sits.

| System | Vendor brand (care sites, NPIs published, NPIs that are members) | NDH copy of the endpoint and its managingOrganization | Members with partOf |
| --- | --- | --- | ---: |
| UPP | MyUPMC: 784 sites, 0 NPIs | `epicent-prd-rp.upmc.com` on CHARTWELL PENNSYLVANIA; `epic-fhir-prd.upmc.com` on UNIVERSITY OF PITTSBURGH MEDICAL CENTER and once with none. Neither org holds a PA role. | 0 of 34 |
| Geisinger | Geisinger: 392 sites, 10 NPIs, 0 members | `geisapi.geisinger.edu`, two copies, no managingOrganization | 0 of 120 |
| St. Luke's | St Luke's: 624 sites, 13 NPIs, 0 members | `fhir.slhn.org` R4 on ST LUKE'S UNIVERSITY HEALTH NETWORK (no PA roles); DSTU2 copy with none | 0 of 257 |
| AHN | Allegheny Health Network: 237 sites, 35 NPIs, 0 members | none (only a Direct address) | 0 of 59 |
| Pinnacle | MyUPMC, as UPP | as UPP | 0 of 213 |
| WellSpan | WellSpan: 774 sites, 1 NPI, 0 members | `interconnect.wellspan.org` on THOMAS HART FAMILY PRACTICE CENTER (no PA roles) | 0 of 144 |

The vendor NPIs do land on directory organizations, just not on these members.
Two of AHN's published NPIs are JEFFERSON REGIONAL MEDICAL CENTER (84 links)
and JEFFERSON HOSPITAL COUNSELING SERVICES (47), which the ledger groups under
JEFFERSON with Thomas Jefferson University. Geisinger's are Evangelical
Medical Services Organization and Caring Community Health Center. WellSpan's
one NPI is Hanover Family Practice.

## Named causes

| Cause | Systems | Fixable by |
| --- | --- | --- |
| `vendor-brand-without-entity-npi`: the vendor publishes the endpoint under a brand, and no NPI it publishes is one the directory files these clinicians under | all 6 | system (Epic brand configuration), vendor |
| `endpoint-on-leaf-without-practitioners`: the NDH carries the endpoint on an organization that holds no PA practitioner roles | UPP, St. Luke's, Pinnacle, WellSpan | system (attach the endpoint to the employing entities), CMS (inherit down a hierarchy) |
| `endpoint-without-managing-org`: an NDH copy of the endpoint names no organization | UPP, Geisinger, St. Luke's, Pinnacle | system, CMS |
| `no-ndh-endpoint`: the NDH carries no FHIR endpoint on the system's domain | AHN | system, CMS |
| `no-hierarchy`: no member carries `partOf` to the organization holding the endpoint | all 6 | system (NPPES subpart, NDH attestation), CMS |
| `rollup-omits-h53-tier`: AINPI defect, see below | Geisinger, St. Luke's, WellSpan | AINPI |
| `rollup-omits-enrollment-own-domain`: AINPI defect, see below | AHN | AINPI |
| `dead-curated-alias`: AINPI defect, see below | UPP, Pinnacle | AINPI |
| `system-split-across-groups`: one vendor brand is matched by several ledger systems | UPP, Pinnacle (with UPMC), AHN (with ALLEGHENY) | system (NPPES parent), AINPI (grouping) |
| `no-endpoint-published` | none | system |

The one cause that would be a statement about the system, publishing nothing,
applies to none of the six.

## Defects in our own method

These outrank the explanation, because each one makes an endpoint that exists
read as absent.

1. **The system rollup ignores two tiers the funnel counts.** In
   `state_connectivity.py` `build()`, the rollup calls `resolve_org()`, which
   accepts only `ndh` and `vendor-npi`. The practitioner funnel in the same
   function also accepts H53 resolution (organization level) and CMS
   enrollment (practitioner level), and the two are different defects. H53
   is the whole zero for Geisinger, St. Luke's and WellSpan: the rollup shows
   Geisinger with zero endpoints while the ledger's state-wide funnel credits
   all 5,199 (measured here) as reaching `geisapi.geisinger.edu`. Enrollment
   is the zero for AHN, where 2,673 of the 2,723 enrollment-tier clinicians
   land on AHN's own domain. For UPP and Pinnacle enrollment reaches 725 and
   398 clinicians, but only 86 and 21 of them land on `upmc.com`, so the
   rollup omission is not what hides UPMC; the dead UPMC alias (defect 2)
   and the split of one brand across three ledger systems are. The
   enrollment cause is raised only when more than half of a system's
   enrollment-tier reach lands on its own domain; the raw count is
   `reach.enrollment_on_own_domain` on every row. The rollup should either
   report endpoints by tier or say in its note that it is NDH and vendor-NPI
   only.
2. **Nine of the thirteen PA curated aliases are dead.** H53's alias tier
   requires the alias brand to equal a vendor-published label exactly. Epic now
   publishes "MyUPMC", "TempleHealth" and "Thomas Jefferson University Health
   System", and no vendor file names "Penn State Health" in PA. So the aliases
   for University of Pittsburgh Physicians, UPMC Community Medicine, PinnacleHealth,
   Regional Health Services, Jefferson University Physicians, both Temple
   entities and both Penn State entities resolve nothing and do not error. If
   the UPMC alias resolved, UPP's 6,793 clinicians would reach MyUPMC at the
   alias tier.
3. **H51 keeps one NPI per endpoint URL.** `parse_bundle()` uses
   `url2npi.setdefault`, so a brand publishing 35 NPIs is reduced to the first.
   Across PA, 528 organizations (9,442 practitioner links) carry an NPI that
   Epic publishes beside an endpoint and that the ledger cannot use; 370 of
   them (6,563 links) are reached by no tier at all. Top cases are Guthrie
   Medical Group (962), DLP Conemaugh Physician Practices (661) and Conemaugh
   Physician Group Cresson (600). None of the 528 is a member of the six
   systems, so this does not change the table above, but it is a deterministic
   link the ledger drops.
4. **System `practitioners` is a link sum** (`org_systems.build_systems`), as
   above.

Also noted, not fixed here: `h53_org_endpoint_resolution.py` still hardcodes
`NDH_RELEASE = "2026-05-08"` although its CSV was regenerated on 2026-10-07.

## Positive control

`positive_control()` returns the problems and the script refuses to write
unless the list is empty: the connectivity payload is on the warehouse
release, the Epic bundle parses to at least 500 brands (1,282 here), the
vendor names at least one host for the analysed systems, the rebuilt
grouping matches the payload row for every analysed system, every system's
members return practitioners from the warehouse, and the NDH Endpoint lookup
finds FHIR endpoints on the domains the vendor names (8 FHIR endpoints on 5
domains here). The grouping check compares link totals and organization
counts, and requires the payload's member ids to be within the rebuilt ones;
it cannot test set equality because the ledger keeps only the first 25
member ids per system. A zero in the output
therefore means the record was searched and holds nothing, not that the
lookup failed.

## Method

1. Rebuild the ledger's grouping with `org_systems.build_systems`, using the
   H53 resolution CSV as the organization list (it is written from the same
   query on the same release) and the NPPES `parent_organization_lbn` query
   the ledger uses. `parent_organization_tin` is not selected.
2. Count distinct clinicians per system from practitioner-to-member pairs
   (one capped query).
3. Read each member's `Organization.endpoint` and `Organization.partOf` from
   the stored resource (filtered on `_npi`, the cluster key).
4. Index Epic's brand file: walk every care site up `partOf` to its brand,
   index entries by `fullUrl` and `Type/id`, and read NPIs with
   `fhir_identifiers.extract_npis`. Match brands to systems by label prefix,
   or by one curated brand per system where the names share nothing (UPMC to
   MyUPMC, AHN to Allegheny Health Network); the basis is on every row.
5. Look up every NDH Endpoint on the brand's registrable domain, which also
   finds a second UPMC host that Epic's file does not list.
6. Count reach per clinician at the strongest tier the ledger's funnel uses,
   and classify.

## Limits

- Membership is the ledger's name-inference grouping. A member that is not
  really part of the system brings its counts with it; a part of the system
  filed under another name is missing.
- Clinicians with no `PractitionerRole` cannot be members of any system, so
  the role gap (56% of PA practitioners) sits outside this table.
- Reaching an endpoint is not the endpoint answering. Liveness is H1 to H5.
- Only Epic's file is indexed for brands. Each of the six matched an Epic
  brand; a system on another vendor would need that vendor's file added
  before its absence could be read as an absence.
