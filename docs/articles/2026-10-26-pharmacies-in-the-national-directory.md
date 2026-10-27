# Pharmacies in the National Directory

*by Eugene Vestel · 2026-10-26 · proposal for the RTPBC and National Directory communities*

CMS NPD already holds almost every pharmacy. Its FHIR records do not say which
ones are pharmacies, and they mostly do not say where pharmacists work. Data:
CMS NPD release 2026-10-07.

---

## In plain words

Think of the National Directory as a phone book. It lists almost every
pharmacy, but it does not write "pharmacy" next to the name. So you can find a
pharmacy if you already know its number, but you cannot ask for "all pharmacies
near me".

It also lists pharmacists, but for most of them it does not say which pharmacy
they work at.

The missing facts already exist in other public sources. They are just not
copied into the phone book.

## What we measured

| Question | Answer |
| --- | --- |
| Active pharmacy organizations in NPPES (any 3336 taxonomy in the first three slots) | 109,203 |
| Of those, with an Organization record in CMS NPD | 108,637 (99.5%) |
| Organization records carrying a pharmacy taxonomy code (3336xxxxxX) | 0 of 2,058,500 |
| Organization records naming any taxonomy code system (NUCC or the NDH taxonomy value set) | 0 |
| Pharmacies whose record mentions an NCPDP ID | 1 of 108,637 |
| Pharmacies carrying an endpoint | 464 of 108,637 |
| HealthcareService records with a service name, type or specialty | 0 of 54,445 |
| Pennsylvania pharmacists in CMS NPD with a PractitionerRole (where they work) | 812 of 11,865 (6.8%) |
| Of those pharmacists, in a CMS-enrolled (Medicare) billing group | 1 |

The NPPES side is the public BigQuery snapshot dated 2026-02-07, so pharmacies
registered since then are not counted. The 108,637 pharmacies sit on 113,077
Organization records. 108,636 are typed `prov`, like every other provider
organization. 4,437 are text-only `ein` tax records that share a pharmacy NPI,
and 4 have no type. The `ein` records explain the gap between records and
NPIs. 45% of these records (50,829 of 113,077) have "pharm" in the name, which
is the only pharmacy signal in the record. Role figures come
from [role coverage by profession](/findings/role-gap-composition); the
HealthcareService figure from [new resource types](/findings/ndh-new-resource-types).

One note on the pharmacist number. All 11,865 people in it already hold an NPI,
so it says nothing about whether pharmacists need one. It shows that having an
NPI does not give someone a workplace record. Across professions, CMS NPD
workplace records follow Medicare billing: in Pennsylvania 74.8% of physicians
have one, against single digits for nurses (6.2%) and the pharmacy category,
technicians included (6.7%). Few pharmacists bill Medicare as individual
providers, which fits that pattern: 1 of the 11,865 is in a CMS-enrolled
group.

## Try it yourself

### 1. The CMS NPD record for a real pharmacy

```bash
curl "https://ainpi.dev/api/npd/search?type=organization&npi=1548282270"
```

Returns "CVS PHARMACY 16602" with type `prov`. Nothing in the record marks it as
a pharmacy. The state shown is Rhode Island, the corporate billing address. The
CMS record also carries the store's physical address, 5125 Jonestown Rd,
Harrisburg PA, marked `type: physical`, after the billing address. A Location
for the store exists in CMS NPD, but nothing links it to this record. AINPI's
search currently shows the first address listed, and we are fixing that.

### 2. The same NPI in NPPES

```bash
curl "https://npiregistry.cms.hhs.gov/api/?version=2.1&number=1548282270"
```

Returns primary taxonomy 333600000X, Pharmacy. Joining the two is the
workaround available today.

### 3. Every Pennsylvania clinician, one row per NPI

```bash
curl -O "https://ainpi.dev/api/v1/findings/role-gap-composition-pa.csv"
```

Columns: `npi, category, taxonomy_code, primary_switch, nppes_deactivated,
ndh_role, cms_enrollment_org`. Keep rows whose `taxonomy_code` begins `1835`
to get the 11,865 pharmacists; `ndh_role = Y` marks a workplace record and a
non-empty `cms_enrollment_org` a CMS-enrolled group. Filtering on
`category = pharmacy` instead gives 12,427, because that category also holds
562 pharmacy technicians (183700000X).

## What already exists

**NPPES taxonomy.** CMS already holds each pharmacy's NUCC code in NPPES. It
does not reach the FHIR export.

**Plan pharmacy directories.** Medicare Advantage plans with drug coverage must
already publish their pharmacy directories through their public Provider
Directory API, including the type of pharmacy. 42 CFR 422.120(b)(2) requires:

> the MA-PD's pharmacy directory, including the pharmacy name, address, phone
> number, number of pharmacies in the network, and mix (specifically the type
> of pharmacy, such as "retail pharmacy")

updated no later than 30 calendar days after the plan receives a change.
Those directories are required to state the type of pharmacy, and nothing in
CMS NPD links them to a plan.

**Open measurement.** AINPI re-measures role coverage and the new resource
types every CMS release, with the method and code, at
[ainpi.dev](https://ainpi.dev). The pharmacy counts above were measured for
this note and are not yet a published series.

## Proposal: how this should work

- **CMS NPD.** Carry the NUCC taxonomy CMS already holds in NPPES into the FHIR
  export, on the Organization and on a HealthcareService per pharmacy. In that
  HealthcareService, set `category` to `pharm`, `specialty` to the 3336 code
  and `providedBy` to the Organization, as NDH models it in its
  [retail pharmacy example](https://hl7.org/fhir/us/ndh/STU1/HealthcareService-PharmChainRetailService.html). Make it searchable. This one change lets
  anyone ask the API for pharmacies.
- **CMS NPD.** Link each pharmacy's Location to its Organization, or at least
  list the physical address first. In this record the store address sits on
  the Organization after the corporate billing address. A Location for the
  store exists (5125 Jonestown Rd #16602, phone 717-671-6903), but it has no
  `managingOrganization` and no PractitionerRole points at it. Linking it lets
  a per-store NPI resolve to a place. We left NCPDP IDs out of this ask. Our
  understanding is that NCPDP licenses its pharmacy data, but we have not
  checked the terms, so whether CMS could republish the IDs is a question for
  NCPDP and CMS.
- **CMS NPD.** Fill pharmacist workplace records from a source beyond Medicare
  billing, and link each MA-PD plan's pharmacy directory endpoint to the plan,
  so a pharmacy can be traced to the networks it belongs to.
- **CARIN RTPBC.** The
  [RTPBC pharmacy profile](https://hl7.org/fhir/us/carin-rtpbc/StructureDefinition-rtpbc-pharmacy-organization.html)
  says the NCPDP Provider ID "is the preferred identifier for this purpose
  because it specifies the individual pharmacy location". It adds that
  "alternatively, an organizational NPI may be used". Phone and address then
  help tell locations apart: they "SHOULD be populated to assist in
  identifying a particular pharmacy location". Marking
  pharmacies in CMS NPD helps the NPI path. It does not replace the NCPDP ID,
  which 1 of 108,637 CMS NPD pharmacy records mentions.
- **Implementers, now.** Look up the pharmacy in CMS NPD by NPI, take its type
  from NPPES, and read the address marked `type: physical` or `use: work`, not
  the first one listed. Pharmacies registered recently may be missing; we have
  not measured how far CMS NPD lags NPPES.
- **AINPI.** Watch HealthcareService and the pharmacy counts each release, so
  everyone can see when the fix lands.

## How we measured

The CMS NPD side is the 2026-10-07 release loaded into BigQuery, read from the
raw `resource` JSON of `cms_npd.organization` rather than from flattened
columns. The NPPES side is `bigquery-public-data.nppes.npi_raw`, whose newest
enumeration is 2026-02-07. A pharmacy is an active type-2 NPI (no deactivation
date) with any taxonomy code beginning 3336 in slots 1 to 3. The counts were
measured on 2026-10-22 and re-run on 2026-10-26 with the same results.

Each query ran in BigQuery with a 100 GB cap:

```bash
bq query --use_legacy_sql=false --maximum_bytes_billed=100000000000 < query.sql
```

Pass the SQL on stdin: a query that begins with a `--` comment is otherwise
read as a command-line flag.

Pharmacies in NPPES, and how many have an Organization record (109,203 and
108,637; about 0.35 GB scanned):

```sql
WITH pharm AS (
  SELECT npi
  FROM `bigquery-public-data.nppes.npi_raw`
  WHERE entity_type_code = 2
    AND npi_deactivation_date IS NULL
    AND (STARTS_WITH(healthcare_provider_taxonomy_code_1, '3336')
      OR STARTS_WITH(healthcare_provider_taxonomy_code_2, '3336')
      OR STARTS_WITH(healthcare_provider_taxonomy_code_3, '3336'))
),
ndh AS (
  SELECT DISTINCT _npi
  FROM `thematic-fort-453901-t7.cms_npd.organization`
  WHERE _npi IS NOT NULL
)
SELECT
  COUNT(*) AS pharmacies,
  COUNTIF(ndh._npi IS NOT NULL) AS with_organization_record
FROM pharm
LEFT JOIN ndh ON ndh._npi = pharm.npi
```

Taxonomy anywhere in any Organization record (0 pharmacy codes, 0 records
mentioning NUCC or the word "taxonomy", which also covers the NDH value set
URL; about 2 GB scanned):

```sql
SELECT
  COUNT(*) AS org_records,
  COUNTIF(REGEXP_CONTAINS(TO_JSON_STRING(resource), r'3336[0-9A-Z]{5}X')) AS pharmacy_code,
  COUNTIF(STRPOS(TO_JSON_STRING(resource), 'nucc.org') > 0) AS nucc_system,
  COUNTIF(REGEXP_CONTAINS(TO_JSON_STRING(resource), r'(?i)taxonomy')) AS any_taxonomy
FROM `thematic-fort-453901-t7.cms_npd.organization`
```

A broader search for any NUCC-shaped string (`"[0-9]{3}[A-Z0-9]{6}X"`) finds 5
records, every one in the `name` field: four organizations whose name is a
taxonomy code, and one called "2020EYEMAX". None is a coded taxonomy.

NCPDP and endpoints on the pharmacy records (1 and 464 pharmacies; about 2.5 GB
scanned):

```sql
WITH pharm AS (
  SELECT npi
  FROM `bigquery-public-data.nppes.npi_raw`
  WHERE entity_type_code = 2
    AND npi_deactivation_date IS NULL
    AND (STARTS_WITH(healthcare_provider_taxonomy_code_1, '3336')
      OR STARTS_WITH(healthcare_provider_taxonomy_code_2, '3336')
      OR STARTS_WITH(healthcare_provider_taxonomy_code_3, '3336'))
)
SELECT
  COUNT(*) AS org_records,
  COUNT(DISTINCT o._npi) AS pharmacies,
  COUNT(DISTINCT IF(STRPOS(LOWER(TO_JSON_STRING(o.resource)), 'ncpdp') > 0,
                    o._npi, NULL)) AS pharmacies_mentioning_ncpdp,
  COUNT(DISTINCT IF(ARRAY_LENGTH(JSON_QUERY_ARRAY(o.resource, '$.endpoint')) > 0,
                    o._npi, NULL)) AS pharmacies_with_endpoint
FROM `thematic-fort-453901-t7.cms_npd.organization` o
JOIN pharm ON pharm.npi = o._npi
```

The 108,637 pharmacies sit on 113,077 Organization records, because 4,437
text-only `ein` tax records share a pharmacy NPI with a `prov` record.
Counted by record rather than by pharmacy, 507 carry an endpoint and 1
mentions NCPDP. As a positive control, every one of the 113,077 records
carries the NPI identifier system and 113,073 carry a `type` key, so the zeros
above come from records the query did read.

The Pennsylvania pharmacist figures are recomputed from the committed
[role-gap-composition-pa.csv](https://ainpi.dev/api/v1/findings/role-gap-composition-pa.csv)
as described in step 3 above: 11,865 rows with `taxonomy_code` beginning
`1835`, 812 of them with `ndh_role = Y`, and 1 with a non-empty
`cms_enrollment_org`.

## Limits

- The NPPES snapshot is from February 2026. Newer pharmacies are in neither
  count.
- The pharmacist figures cover Pennsylvania only.
- "Pharmacy" here means any 3336 taxonomy in the first three NPPES slots. A
  narrower definition, such as 333600000X only, gives a smaller count.
- Endpoint and identifier counts read the raw FHIR JSON of the 2026-10-07
  release. They do not test whether an endpoint answers.

Questions or corrections: Eugene Vestel, gene@fhiriq.com. Method and code are
open at [github.com/FHIR-IQ/AINPI](https://github.com/FHIR-IQ/AINPI). Every
number here should be checked against the primary source before you rely on it.
