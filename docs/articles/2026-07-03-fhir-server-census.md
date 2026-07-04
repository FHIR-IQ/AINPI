# Five software products serve half the federal provider directory's live FHIR hosts

When AINPI crawled every distinct FHIR-REST host referenced by the CMS
National Provider Directory (2,974 hosts, 2026-04-09 release, one probe per
host), 2,539 of them (85.4%) returned a parseable CapabilityStatement. That
document includes a self-declared `software.name`, which makes a census
possible. The top five names:

| Declared software | Hosts | Share of conformant hosts |
|---|---:|---:|
| Firely Server | 505 | 19.9% |
| Epic | 456 | 18.0% |
| Fhir Server | 282 | 11.1% |
| Altera FHIR | 71 | 2.8% |
| 1up FHIR Server | 42 | 1.7% |

Five names cover 1,356 hosts, or 53.4% of everything that answered
conformantly. The rest is a long tail of smaller products, custom builds,
and hosts that declare nothing.

The same CapabilityStatements declare their FHIR version:

| Declared fhirVersion | Hosts |
|---|---:|
| 4.0.1 (R4) | 1,599 |
| 4.0.0 (R4, superseded) | 938 |
| 3.0.2 (STU3) | 1 |
| 3.0.1 (STU3) | 1 |

Zero R4B. Zero R5. Two hosts still on STU3.

## Why it matters

1. **The national endpoint layer is a concentrated stack.** Roughly one in
   five live hosts runs Firely Server, and nearly as many run Epic. That cuts
   both ways: a conformance fix in one product improves hundreds of endpoints
   at once, and a defect in one product degrades hundreds of endpoints at
   once. Anyone testing an integration against "the NDH endpoint population"
   is mostly testing against five server implementations.

2. **938 of 2,539 conformant hosts (36.9%) declare a superseded version
   string.** HL7 published R4 as 4.0.0 in December 2018 and patched it to
   4.0.1 in October 2019; 4.0.1 is the version US regulations pin. Most of
   these hosts are probably running current software with a stale
   declaration, but the declaration is the only machine-readable version
   signal an integrator gets, and a third of it points at a release that was
   superseded more than six years ago.

3. **The census is only as honest as the self-declaration.** `software.name`
   is whatever the server says about itself. "Fhir Server", the third-largest
   name, is a generic string that identifies a codebase, not an operator.
   Treat these as declared identities, not verified ones, the same way the
   directory itself should be treated.

## Verify it yourself

The crawl is finding H1-H5 (endpoint liveness). One request per second per
host, identified User-Agent, one endpoint probed per distinct host. The
counts above are in the published finding notes.

- Finding: <https://ainpi.dev/findings/endpoint-liveness>
- Compute script: [`analysis/h1_h5_h22_full.py`](https://github.com/FHIR-IQ/AINPI/blob/main/analysis/h1_h5_h22_full.py)
- Source data: <https://directory.cms.gov/> (2026-04-09 release)
