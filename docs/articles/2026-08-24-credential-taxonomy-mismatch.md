# 70,314 non-physicians hold a physician taxonomy code. 2.6% of that is how the question was asked.

*by Eugene Vestel · 2026-08-24 · exploratory, not a pre-registered finding*

---

The CMS National Directory of Healthcare team published an aggregate this week.
It lists every NPPES credential holder whose credential text is non-physician
but whose chosen taxonomy code is a physician-level one. 4,459 rows of
(credential, taxonomy, count), covering 70,314 providers, 305 distinct
credentials and 227 distinct taxonomies.

The number holds up. **97.4% of it survives every caveat I could find.** This
piece is about the other 2.6%, because that part is worth knowing before anyone
quotes the total, and because two of the three explanations are the kind that
make an alarming row look worse than it is.

**This is exploratory and it is not a finding.** Every AINPI finding registers
its hypothesis before the numbers exist. This one ran the other way around: CMS
published, and the analysis followed. Publishing it as a finding would spend
credibility the pre-registration discipline is there to earn, so it is published
as exploratory instead. The compute script is
`analysis/explore_credential_taxonomy.py` and the data is at
[/api/v1/exploratory/credential-taxonomy-mismatch.json](https://ainpi.dev/api/v1/exploratory/credential-taxonomy-mismatch.json).

## 1,148 of them are oral and maxillofacial surgeons, and they are right

NUCC files taxonomy `204E00000X`, Oral & Maxillofacial Surgery, under the
grouping *Allopathic & Osteopathic Physicians*. The board that certifies those
practitioners, ABOMS, certifies dentists. So DDS and DMD is the correct
credential for that code, and 1,148 providers appear in this file for holding
exactly the code they should hold.

Two more taxonomies have the same shape. `207SG0203X` and its siblings under
Medical Genetics sit in the physician grouping, and ABMGG certifies PhD
laboratory geneticists. `2085R0205X`, Radiological Physics, sits there too, and
ABR certifies PhD medical physicists. 280 providers between them.

I checked all seven codes against the NUCC 26.1 file rather than asserting the
grouping, and the script re-checks on every run. If NUCC moves one of them out
of the physician grouping, the carve-out stops being necessary and the script
says so rather than carving anyway.

The general form: **a filter defined on the NUCC grouping is not the same
question as a filter defined on who is licensed to practice medicine.** Three
specialties sit in the gap.

## 372 are the credential being decoded wrong, not the provider choosing wrong

Three abbreviations are expanded incorrectly in the source, and all three land
on the rows that look most alarming at a glance.

| Code | Source expansion | Actual | Providers | Concentration |
| --- | --- | --- | --- | --- |
| `AA` | Associate of Arts | Anesthesiologist Assistant | 183 | 97.8% on anesthesiology |
| `CAA` | Certified Audiologist Assistant | Certified **Anesthesiologist** Assistant | 94 | 100% on anesthesiology |
| `CSFA` | Certified School Food Administrator | Certified Surgical First Assistant | 95 | 97.9% on surgical codes |

**The concentration is the evidence, not the expansion.** Anyone can propose a
different reading of an abbreviation. What settles it is that Associate of Arts
holders have no reason to pick anesthesiology 98% of the time, and Certified
School Food Administrators have no reason to pick surgery. A wrong expansion
does not cluster. These do, and they cluster on precisely the specialty the
correct expansion names.

Read at face value, these 372 rows say that nursing assistants and food service
administrators are claiming to be anesthesiologists and surgeons. They are
anesthesiologist assistants and surgical first assistants, in the specialty they
actually work in, with a taxonomy question that is real but much less lurid.

## The remaining 68,514 look real, and the distribution is the finding

Nurse practitioner credentials account for 31,111 and physician assistant
credentials 17,423, which is most of the file and roughly what anyone would
predict. The interesting part is underneath.

**Physical therapists choosing Physical Medicine & Rehabilitation Physician:
5,723** across the PT credential family. That is the largest cluster after NP
and PA, and it is a single taxonomy that reads, to software, as a physiatrist.

**Athletic trainers choosing a sports medicine physician code: 655.**

**Optometrists choosing Ophthalmology Physician: 134.** This is the smallest of
the three and the one I would rank first for consumer consequence. Optometry and
ophthalmology differ in surgical scope. A patient who searches a directory for
an ophthalmologist and is routed to an optometrist has hit a real difference,
and nothing in the record tells them so.

That ordering matters more than the total. A count of 70,314 is a statement
about a file. Which professions are picking which codes is a statement about
where a patient or a payer gets a wrong answer.

## One small thing about the file

It carries two UTF-8 byte order marks. `utf-8-sig` strips one, so a naive read
leaves a BOM glued to the first column name and silently drops that column.
Every ingest this project runs now assumes source encoding is inconsistent and
unannounced, because it reliably is.

## What this is not

It is not a measurement of fraud, and it is not a measurement of anyone
practicing outside their scope. A taxonomy code is a self-attested
classification in a registry with no enforcement behind it. What this file
measures is a mismatch between two self-attested fields, which is a data quality
problem first. Whether any individual row is anything more than a form-filling
error is not answerable from this data and should not be asserted from it.

Source: aggregate published by the CMS National Directory of Healthcare team.
Reference data: NUCC taxonomy 26.1. Corrections welcome at
[github.com/FHIR-IQ/AINPI/issues](https://github.com/FHIR-IQ/AINPI/issues).
