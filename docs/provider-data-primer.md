# A primer on provider and endpoint data

Everyone in this field uses the same words for different things. An NPI is two
different kinds of thing depending on who is talking. "Organization" means at
least three things inside one federal file. "Endpoint" usually means something
you can query, except 91.6% of the time it does not.

This page is the plain explanation nobody had written down: what each
identifier is, what each FHIR resource holds, how they join, and which joins
are safe. It is aimed at somebody capable who does not already live in this
data.

Every number quoted here is measured against a pinned public release and links
to the finding that produced it. Where something is broken we say so and show
the count.

## The identifiers

You cannot reason about provider data without knowing which key you are
holding. These are the ones that matter.

| Identifier | What it identifies | Public? | Watch out |
|---|---|---|---|
| **NPI, type 1** | One individual clinician | Yes | Follows the person, not the job. A clinician who moves keeps it. |
| **NPI, type 2** | One organization | Yes | An organization can hold many. Subparts each get their own. |
| **Pseudo-EIN** | One tax entity, as a UUID | Yes | A privacy-preserving stand-in for the EIN. Groups NPIs under one taxpayer without publishing the tax ID. |
| **EIN** | One tax entity | No | Never published. The pseudo-EIN exists because of this. |
| **PAC ID** | One legal entity in Medicare enrollment | Yes | The public equivalent of a TIN for grouping. Stable across enrollments. |
| **Enrollment ID** | One enrollment of one provider | Yes | A provider has many. Not an entity key. |
| **CCN** | One Medicare-certified facility | Yes | Hospitals, SNFs, hospices. Not clinicians. |
| **NUCC taxonomy code** | A provider's kind of practice | Yes | Self-selected. A provider may carry up to 15. Only one is primary, and some records mark none. |

The single most common mistake is treating an NPI as an entity key. It is a
license plate, not a company registration. One health system routinely holds
hundreds.

## The FHIR resources

The federal directory publishes six resource types. Here is what each is for
and what it actually contains.

| Resource | Answers | Reality check |
|---|---|---|
| **Practitioner** | Who is this clinician? | Names, addresses, phone. Nearly complete. |
| **PractitionerRole** | Where does this clinician work? | The load-bearing link, and the one most often absent. |
| **Organization** | What is this entity? | Three different kinds of record live here. See below. |
| **OrganizationAffiliation** | How do two organizations relate? | Carries no code saying what the relationship is, so it cannot be interpreted. |
| **Location** | Where is the physical site? | Holds the only coordinates in the directory. |
| **Endpoint** | Where can software connect? | Mostly Direct messaging addresses, not queryable APIs. |

## How they join

The chain that matters runs left to right, and every arrow is a place it can
break:

    Practitioner -> PractitionerRole -> Organization -> Location -> Endpoint -> EHR vendor

Read that as a series of questions. Who is the clinician? Where do they work?
Does that workplace exist as a record? Does it have a physical site? Does
anything publish a way for software to reach it? Who runs that software?

A break at any arrow ends the chain. Most breaks happen at the first one.

## Three kinds of Organization record

This trips up almost everyone the first time.

The `Organization` file mixes provider records with tax-entity records and a
small tail of teams and government bodies. They are distinguished by `type`,
and the tax records carry only free text rather than a real coding:

    provider record:  "type": [{"coding": [{"code": "prov", ...}]}]
    tax record:       "type": [{"text": "ein"}]

The tax record aggregates its members by repeating their NPIs in
`identifier[]`. The provider record points back by carrying the pseudo-EIN.
So the grouping runs through identifiers in both directions rather than
through a reference.

Pick one kind before counting anything. A count of "organizations" that
includes both is counting many entities twice.

## Joins that are safe, and joins that are not

**Safe.** NPI to NPPES. NPI to Medicare enrollment. Pseudo-EIN to its member
NPIs. Practitioner to PractitionerRole by reference. Organization to Location
by managing organization.

**Not safe, and here is why.**

*Organization name to organization name.* Legal names and brand names share no
tokens for the largest systems. "UNIVERSITY OF PITTSBURGH PHYSICIANS" is
UPMC's physician group, and no normalization rule recovers that. Loose matching
is worse than none: a one-token brand prefix once matched "PENN STATE HEALTH
MEDICAL GROUP" to Penn Medicine, a different health system, which would have
handed 857 practitioners the wrong endpoint.

*OrganizationAffiliation edges as corporate structure.* The resource carries no
code stating what the relationship is. Grouping by connected components merges
unrelated organizations through shared hubs, and the largest hubs are retail
pharmacy chains rather than health systems.

*Pseudo-EIN as a corporate parent.* It is a tax key and it does its job. It is
not a brand or a health system. The largest groups are national retail chains.

*Organization.partOf as a hierarchy.* This one **changed**, and it is worth
knowing which release you are holding. In the 2026-05-08 export all 148,834
`partOf` references pointed at organizations that were not published, so the
field resolved to nothing at all. In 2026-08-20 CMS shipped the parents:
140,017 references, 43,551 distinct targets, none dangling. If you built
around the field being useless, rebuild.

## The failure mode to design around

Every break this project has hit in this data has the same shape. Something in
the source changes. The code reading it does not crash. It returns nothing, and
nothing looks like an answer.

Three examples, all real, all from the 2026-08-20 release:

- The provider-taxonomy code system URL changed from
  `http://nucc.org/provider-taxonomy` to
  `http://hl7.org/fhir/us/ndh/ValueSet/HealthcareIndividualTaxonomyVS`. A
  parser matching the old string reports that no provider in the country has a
  valid specialty. (The new URL is also a ValueSet canonical in a field FHIR
  defines as a CodeSystem canonical, which is worth raising upstream.)
- The NPI identifier system URL changed in the May release, from
  `http://hl7.org/fhir/sid/us-npi` to
  `http://terminology.hl7.org/NamingSystem/npi`. Same result: zero NPIs, no
  error.
- `PractitionerRole.specialty` switched from CMS Medicare specialty codes to
  NUCC taxonomy codes. Validating against the old code set gives 0% valid.

None of these raise an exception. If you match on a system URL, match on every
URL the field has ever carried, and alert when a count you expect to be large
comes back small. A hard failure you can see beats a soft one you cannot.

The same applies to your reference data, not just to the source. Comparing this
directory against a copy of NPPES that stops six months earlier makes a quarter
of a million working clinicians look like ghosts. Check how current your
reference file is before you trust a mismatch against it.

## What is actually missing

There is no brand or health-system layer. Nothing in the directory says that
one organization is part of a larger system a patient would recognize. The
identifiers group by taxpayer and by enrollment, neither of which is the thing
a patient means by "my hospital".

That gap is why endpoint attribution is hard. The vendor that runs the software
publishes a brand. The directory publishes legal entities. Joining the two is
the unsolved problem, and it is solvable, because the vendor files are public.

## Who else is measuring this

We audit one federal file. Other people work the payer side, directory
accuracy scoring, and what breaks when an application actually tries to use
this data. Their research is listed, with links and quotes, at
[related work](/partners).

## Reading the scoreboard

The metrics below are reproducible from public data. They are stated so that
progress is arguable rather than felt, and so anyone can recompute them against
the next release without taking our word for anything.

That is not decorative. Between 2026-05-08 and 2026-08-20 one of these went
from 0% to 100% and another went backwards, which is exactly the kind of
movement a single snapshot hides.
