# Networks research: national routes and networks

Date: 2026-11-06. Data file: `frontend/public/api/v1/networks.json`.

## Purpose

Fill the `routes` array for the seven use cases on `/networks` and the national entries in `networks`: every designated QHIN, the vendor networks Carequality and CommonWell Health Alliance, DirectTrust, and the CMS payer API programs. State and multi-state networks are a separate task. Every route and network cites at least one primary source, and every source carries `accessed: 2026-11-06`.

## How pages were read

Pages were fetched with curl (`curl -sSL`, browser user agent) and converted to text locally; the URL recorded is the final URL after redirects, since healthit.gov and cms.gov both redirected the paths typed. Two hosts, carequality.org and directtrust.org, return HTTP 403 to curl and to WebFetch. Those pages were read once in a browser session on the same day, as a person would read them, and are listed below as checked by hand. Changing request headers to get past the 403 was not attempted.

## Sources read on 2026-11-06

TEFCA and QHINs (primary):

- https://rce.sequoiaproject.org/designated-qhins/ (the designated-QHIN list; read the linked logos and links, since the names are images with empty alt text)
- https://rce.sequoiaproject.org/exchange-purposes-explained/
- https://rce.sequoiaproject.org/participate/
- https://rce.sequoiaproject.org/rce-tefca-for-individuals/
- https://rce.sequoiaproject.org/tefca/how-it-works/
- https://rce.sequoiaproject.org/rce-tefca-on-fhir/
- https://rce.sequoiaproject.org/astp-and-the-sequoia-project-designate-eclinicalworks-as-qhin/
- https://rce.sequoiaproject.org/astp-and-the-sequoia-project-designate-netsmart-as-qhin/
- https://rce.sequoiaproject.org/new-designated-qhin-new-sops-and-more/ (names Oracle Health Information Network as designated)
- https://rce.sequoiaproject.org/news-and-announcements/
- https://healthit.gov/policy/tefca/ (ASTP/ONC; redirected from the healthit.gov topic path)

Each QHIN's own page, as linked from the RCE list: commonwellalliance.org (and its TEFCA and Carequality page), eclinicalworks.com TEFCA page, ehealthexchange.org/tefca, open.epic.com/Home/Interoperate/TEFCA (the RCE list links epic.com, whose home page does not describe the QHIN; Epic's TEFCA overview does), healthgorilla.com, kno2.com, konza.org/company/qhin, medallies.com, ntst.com, oracle.com/health/interoperability/qhin, surescripts.com Interconnect page.

ASTP/ONC and eCFR (primary):

- https://healthit.gov/health-it-basics/hie/ (What is HIE?, directed and query-based exchange)
- https://healthit.gov/test-method/standardized-api-for-patient-and-population-services-acb-atl/ (170.315(g)(10))
- https://healthit.gov/test-method/transmission-public-health-agencies-electronic-case-reporting/ (170.315(f)(5))
- https://healthit.gov/test-method/direct-project/ (170.315(h)(1))
- eCFR 45 CFR 170.404 (service base URL publication, (b)(2)), 45 CFR 170.315, 45 CFR 170.205 ((d)(2), HL7 2.5.1)
- eCFR 42 CFR 482.24 (paragraph (d), electronic notifications)

CMS and Federal Register (primary):

- CMS-9115-F rule page, the CMS Interoperability and Patient Access fact sheet, and the Federal Register document (85 FR 25510)
- CMS-0057-F rule page, the CMS-0057-F fact sheet, and the Federal Register document of February 8, 2024
- https://directory.cms.gov/ and https://directory.cms.gov/downloads/manifest.json
- https://github.com/DSACMS/npd (CMS's source repository for the directory; cited as a secondary source)

Networks (primary for their own entries):

- https://carequality.org/ (checked by hand in a browser; 403 to curl)
- https://directtrust.org/what-we-do/direct-secure-messaging, /what-we-do/directory-services, /what-we-do/trust-framework (checked by hand in a browser; 403 to curl)
- CommonWell Health Alliance: home page, Connect to the Network, TEFCA and Carequality, Membership Information

## What was added

Routes (20): treatment-records-vendor-network, treatment-records-state-hie, treatment-records-qhin, treatment-records-direct, individual-access-provider-api, individual-access-payer-api, individual-access-tefca-ias, find-endpoint-ndh, find-endpoint-vendor-lists, find-endpoint-payer-directory, find-endpoint-direct-directory, payer-exchange-patient-access, payer-exchange-provider-access, payer-exchange-payer-to-payer, payer-exchange-prior-authorization, encounter-alerts-state-hie, encounter-alerts-hospital-cop, public-health-direct-reporting, public-health-tefca, community-referral-direct.

National networks: one QHIN entry for every organization on the RCE designated-QHIN page as read on 2026-11-06 (CommonWell Health Alliance, eClinicalWorks PRISMANet, eHealth Exchange, Epic Nexus, Health Gorilla, Kno2, KONZA Health, MedAllies, Netsmart, Oracle Health Information Network, Surescripts Health Information Network); Carequality and CommonWell Health Alliance as `vendor_network`; DirectTrust as `direct`; and payer API entries for the Patient Access, Provider Directory, Provider Access, Payer-to-Payer and Prior Authorization APIs, each with the CMS rule page as `website`.

## Omitted candidates

- `public-health` via the state HIE. No national primary source read today states that state HIEs carry public health reporting in general. ASTP's What is HIE? page says directed exchange is used to send immunization data to public health, which describes the exchange method, not HIEs as organizations. The route is left for the state task, to be added where a state source shows an HIE doing it.
- `community-referral` via a state HIE or community information exchange. The brief makes this conditional on a source; none was read at the national level. Left for the state task.
- No QHIN, vendor network or payer program was omitted for lack of a primary source.

## Ambiguities and how they were resolved

- QHIN names. The RCE page shows logos with empty alt text. Names come from the RCE's own designation announcements where they exist (the Netsmart announcement lists CommonWell Health Alliance, eClinicalWorks, eHealth Exchange, Epic Nexus, Health Gorilla, Kno2, KONZA Health, Surescripts Health Information Network and MedAllies; a later RCE update names Oracle Health Information Network) and otherwise from the QHIN's linked page. An earlier RCE announcement calls KONZA "KONZA National Network"; the later announcement and KONZA's page say KONZA Health, which is used. eClinicalWorks names its QHIN PRISMANet on its own page; the entry uses "eClinicalWorks PRISMANet". No count of QHINs is written anywhere, as the RCE page says the list changes.
- CommonWell Health Alliance is both a designated QHIN and a vendor network. It has two entries with different types, one for each role. CommonWell's own page describing its Carequality connection is cited on the Carequality entry as a secondary source (`primary: false`); carequality.org is the primary source there.
- Payer-to-Payer data window. The fact sheet says payers are only required to share data with a date of service within five years of the request; the route uses that wording rather than "up to five years".
- Which TEFCA routes each QHIN carries. Every QHIN carries the Treatment route, because the Treatment exchange purpose SOP sets when QHINs and their participants must respond to treatment queries. Individual Access Services and Public Health are attached only where the QHIN's own page says it offers them: IAS for eClinicalWorks, eHealth Exchange, Epic Nexus, Health Gorilla and Oracle; Public Health for eHealth Exchange, Epic Nexus, Health Gorilla and KONZA Health. Netsmart's page mentions public health only as a product line, and MedAllies' and Oracle's pages mention public health agencies only in passing; those were not treated as offering the route. A missing route on a QHIN entry means its page did not state it, not that the QHIN does not support it.
- CMS-0057-F compliance dates. The CMS fact sheet states operational provisions generally beginning January 1, 2026, API requirements generally beginning January 1, 2027, and that exact dates vary by type of payer. Each API's date is quoted as the fact sheet words it ("by January 1, 2027"; Prior Authorization API "beginning January 1, 2027"), and the route rule text repeats that dates vary by payer type.
- Provider Directory API scope. The CMS-9115-F fact sheet says the requirement excludes QHP issuers on the federally facilitated exchanges, which already have a separate machine-readable directory requirement. The route states the exclusion.
- TEFCA standard. The RCE says exchange began with IHE-based exchange of C-CDA documents, and its FHIR roadmap page says TEFCA keeps a baseline of required IHE transactions while the draft QTF version 2 supports, but does not require, named FHIR implementation guides. Because that statement is about a draft, the route says the roadmap adds FHIR as an option alongside the required IHE transactions, and does not say FHIR is supported today. It does not name a single IHE profile, since the profile list was not read in the QTF itself.
- Hospital e-notifications. 42 CFR 482.24(d) applies to hospitals whose system conforms to 45 CFR 170.205(d)(2), which eCFR shows as HL7 2.5.1. The route names HL7 2.5.1 and does not name a narrower ADT implementation guide. The CoP lets a hospital send notifications directly or through an intermediary, which is why the HIE route cites it.
- The Patient Access API compliance date in CMS-9115-F (January 1, 2021) is history and is not repeated in route text.

## Link check

`python3 analysis/networks_link_check.py` on 2026-11-06 reported no dead links. Blocked (HTTP 403 to the bot user agent) and checked by hand: carequality.org, the DirectTrust pages, and oracle.com's QHIN page (which returned 200 to a browser user agent when it was read).
