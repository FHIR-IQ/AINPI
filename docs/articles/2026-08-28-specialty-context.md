# The directory has a place to record what a doctor does at each hospital. It is empty 68% of the time.

*by Eugene Vestel · 2026-08-28 · exploratory, not a pre-registered finding*

---

A question came up in the CMS National Directory of Healthcare community
channel this week. A physician can be an internist at one organization and
practise a subspecialty at another, and NPPES flags only one taxonomy as
primary. So which specialty should a directory publish, and whose definition of
primary governs the record a patient eventually sees?

The question is usually argued from first principles. It is answerable from the
data instead, because FHIR already models the thing being asked for and the
2026-08-20 NDH release is sitting in a warehouse. `PractitionerRole.specialty`
is scoped to one practitioner at one organization, and its cardinality is 0..*.
A practitioner can carry a different specialty at each place they work, and more
than one at the same place.

Three numbers, in the order they matter.

**This is exploratory and it is not a finding.** Every AINPI finding registers
its hypothesis before the numbers exist. This one followed a question that was
already on the table. Publishing it as a finding would spend the credibility
that discipline exists to earn. The compute script is
`analysis/explore_specialty_context.py` and the data is at
[/api/v1/exploratory/specialty-context.json](https://ainpi.dev/api/v1/exploratory/specialty-context.json).

## Multi-specialty is real, and NPPES is not the part that is broken

1,334,111 of 7,139,831 individual NPIs in NPPES carry more than one taxonomy.
That is 18.7%. 336,504 carry three or more, and the maximum is the full 15
slots.

Every one of those NPIs has exactly one slot flagged primary. Not zero, not two.
The primary switch is internally consistent across the whole file, so whatever
goes wrong downstream is not NPPES contradicting itself. It is consumers
reading the file, and one way of reading it is worth naming: slot 1 is not the
primary slot in 14.97% of rows. Anyone treating the first taxonomy as primary is
wrong for about one provider in seven.

The NDH has the same property, which I only established by re-running this
against the whole array rather than the first entry. The directory carries the
NPPES taxonomy set rather than a choice from it: 100.0% of practitioners hold a
qualification matching the NPPES true primary somewhere in the array. Read
`qualification[0]` alone and that falls to 88.7%. So the NDH is not disagreeing
with NPPES about primacy. It is declining to encode primacy at all, because
position does not mean anything in either file. Both figures are in the
[NPI and taxonomy correctness](https://ainpi.dev/findings/npi-taxonomy-correctness)
finding.

That is worth sitting with, because it is the whole difficulty of expressing
this data in a flat one-taxonomy-per-provider format. The set is there. Which
member of it is primary is not.

## The NDH does use the context-scoped field, for a minority

Of the practitioners holding at least one active role that carries both an
organization and a specialty, 131,539 carry more than one specialty at a single
organization. The record maximum is 16.

Of the 445,527 practitioners the directory places at two or more organizations,
82,977 carry a different specialty at differently-named ones. That is 18.6%.
Counting organization records rather than names it is 89,061, and the 6,084
between the two figures are practitioners whose specialty differs only across
duplicate records for the same organization. The stricter number is the one to
quote. The rest carry the same specialty everywhere.

You can look at them. A thousand of these cases are browsable at
[/exploratory/specialty-by-organization](https://ainpi.dev/exploratory/specialty-by-organization),
searchable by name, NPI, organization or specialty.

So the model is not collapsing everyone to one provider-level code. One in five
multi-organization practitioners has a genuinely context-scoped record today.
What that 18.6% cannot tell you is whether it is the true rate of context
variation or only the rate at which somebody bothered to record it. Those are
different claims and this measurement does not separate them.

## The field is empty far more often than it disagrees

11,269,522 of 16,545,158 PractitionerRole records carry no specialty element at
all. That is 68.1%.

Counted per person rather than per record it is starker. 7,373,232 practitioners
are active in the release. 2,315,046 of them carry any role at all. Only
1,193,395, or 16.2%, have a role-level specialty anywhere in the directory.

For the other 84% there is no context-scoped answer to interpret, so a consumer
falls back to the provider-level code. Not because it chose to flatten the
record, but because it is the only code present. The argument about which
taxonomy should be primary is being had about a field that is populated for one
practitioner in six.

## What follows

The lever with the most reach here is not settling which code is primary. It is
requiring a specialty on any published role.

Be precise about how far that goes. A floor on `PractitionerRole.specialty`
reaches the 2,315,046 practitioners the directory already affiliates, which is
31% of the active set. It would roughly double the population with a
context-scoped specialty. It does nothing for the 69% carrying no role at all,
and that gap is larger and is a different problem, measured in
[the role gap composition](https://ainpi.dev/findings/role-gap-composition).

Three notes on the numbers above. They are read from the stored FHIR records
rather than from the flattened `_specialty_code` column this project also keeps,
which holds the first specialty per record only. An earlier pass through that
column returned 52,898 for the varies-by-organization count instead of 89,061,
and the same shortcut sat behind three figures in the taxonomy finding, which
have now been recomputed across the full arrays and republished. Roles with no organization
reference are excluded from the variation counts, because whether a specialty
varies by organization is undefined without one. And the NPPES multiplicity figures come
from the BigQuery public snapshot, whose newest enumeration is 2026-02-07, so
they describe the shape of taxonomy multiplicity rather than its current level.
