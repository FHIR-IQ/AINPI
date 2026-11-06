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

Routes added in the national pass: treatment-records-vendor-network, treatment-records-state-hie, treatment-records-qhin, treatment-records-direct, individual-access-provider-api, individual-access-payer-api, individual-access-tefca-ias, find-endpoint-ndh, find-endpoint-vendor-lists, find-endpoint-payer-directory, find-endpoint-direct-directory, payer-exchange-patient-access, payer-exchange-provider-access, payer-exchange-payer-to-payer, payer-exchange-prior-authorization, encounter-alerts-state-hie, encounter-alerts-hospital-cop, public-health-direct-reporting, public-health-tefca, community-referral-direct.

National networks: one QHIN entry for every organization on the RCE designated-QHIN page as read on 2026-11-06 (CommonWell Health Alliance, eClinicalWorks PRISMANet, eHealth Exchange, Epic Nexus, Health Gorilla, Kno2, KONZA Health, MedAllies, Netsmart, Oracle Health Information Network, Surescripts Health Information Network); Carequality and CommonWell Health Alliance as `vendor_network`; DirectTrust as `direct`; and payer API entries for the Patient Access, Provider Directory, Provider Access, Payer-to-Payer and Prior Authorization APIs, each with the CMS rule page as `website`.

## Omitted candidates

- `public-health` via the state HIE. No national primary source read today states that state HIEs carry public health reporting in general. ASTP's What is HIE? page says directed exchange is used to send immunization data to public health, which describes the exchange method, not HIEs as organizations. The route is left for the state task, to be added where a state source shows an HIE doing it. Added later from Pennsylvania sources; see Batch 7a.
- `community-referral` via a state HIE or community information exchange. The research rules make this conditional on a source; none was read at the national level. Left for the state pass. Added later from Pennsylvania sources; see Batch 7a.
- No QHIN, vendor network or payer program was omitted for lack of a primary source.

## Ambiguities and how they were resolved

- QHIN names. The RCE page shows logos with empty alt text. Names come from the RCE's own designation announcements where they exist (the Netsmart announcement lists CommonWell Health Alliance, eClinicalWorks, eHealth Exchange, Epic Nexus, Health Gorilla, Kno2, KONZA Health, Surescripts Health Information Network and MedAllies; a later RCE update names Oracle Health Information Network) and otherwise from the QHIN's linked page. An earlier RCE announcement calls KONZA "KONZA National Network"; the later announcement and KONZA's page say KONZA Health, which is used. eClinicalWorks names its QHIN PRISMANet on its own page; the entry uses "eClinicalWorks PRISMANet". No count of QHINs is written anywhere, as the RCE page says the list changes.
- CommonWell Health Alliance is both a designated QHIN and a vendor network. It has two entries with different types, one for each role. CommonWell's own page describing its Carequality connection is cited on the Carequality entry as a secondary source (`primary: false`); carequality.org is the primary source there.
- Patient Access API eligibility (first revision). The route lists the plan types and the fact sheet's exclusions as the fact sheet words them: issuers offering only stand-alone dental plans (SADPs) and QHP issuers offering coverage in the Federally-facilitated Small Business Health Options Program (FF-SHOP).
- Provider Access API eligibility (first revision). The fact sheet says payers associate patients with "in-network or enrolled providers" with whom they have a treatment relationship; the route uses that wording.
- Payer-to-Payer data window. The fact sheet says payers are only required to share data with a date of service within five years of the request; the route uses that wording rather than "up to five years".
- Which TEFCA routes each QHIN carries (revised in the first revision). Every QHIN carries the Treatment route, because the Treatment exchange purpose SOP sets when QHINs and their participants must respond to treatment queries. For Individual Access Services and Public Health the evidence bar is: the QHIN's own page states, about its own QHIN service, that the service or exchange purpose is offered through it. A navigation item, a list of the kinds of organizations a QHIN serves or connects, and a general explanation of TEFCA's exchange purposes do not meet the bar. Applied to each page read on 2026-11-06:
  - Epic Nexus: meets the bar for both. Epic's TEFCA overview says Epic organizations participate for the Treatment, Individual Access Services and Public Health Reporting use cases.
  - eClinicalWorks PRISMANet: meets it for Individual Access Services. Its TEFCA page has a section on TEFCA for Individual Access Services under what participating through PRISMANet means for patients. No public health statement.
  - Oracle Health Information Network: meets it for Individual Access Services (its page offers individual access within a QHIN-enabled patient portal). Not for Public Health: the page says providers can exchange clinical data with public health organizations through the QHIN, which names an audience, not the public health exchange purpose.
  - KONZA Health: meets it for Public Health. Its QHIN page lists relieving the burden of public health reporting as a benefit of its QHIN services, which names the purpose as something its service does.
  - eHealth Exchange: does not meet it. Public Health and Individual Access appear as navigation items, and its TEFCA text says it will connect participants including public health agencies, which is an audience list. Both routes were removed from this entry in the first revision.
  - Health Gorilla: does not meet it. Its page lists all the TEFCA exchange purposes with one-line definitions, a general TEFCA explainer. Both routes were removed in the first revision.
  - MedAllies, Netsmart, Kno2, Surescripts and CommonWell: no statement meeting the bar (MedAllies lists public health agencies among those it serves; Netsmart's public health text is about an EHR product).
  A missing route on a QHIN entry means its page did not meet this bar, not that the QHIN does not support the purpose. Both TEFCA routes say this in their how_to_join text.
- CMS-0057-F compliance dates. The CMS fact sheet states operational provisions generally beginning January 1, 2026, API requirements generally beginning January 1, 2027, and that exact dates vary by type of payer. Each API's date is quoted as the fact sheet words it ("by January 1, 2027"; Prior Authorization API "beginning January 1, 2027"), and the route rule text repeats that dates vary by payer type.
- Provider Directory API scope. The CMS-9115-F fact sheet says the requirement excludes QHP issuers on the federally facilitated exchanges, which already have a separate machine-readable directory requirement. The route states the exclusion.
- TEFCA standard. The RCE says exchange began with IHE-based exchange of C-CDA documents, and its FHIR roadmap page says TEFCA keeps a baseline of required IHE transactions while the draft QTF version 2 supports, but does not require, named FHIR implementation guides. Because that statement is about a draft, the route says the roadmap adds FHIR as an option alongside the required IHE transactions, and does not say FHIR is supported today. It does not name a single IHE profile, since the profile list was not read in the QTF itself.
- Hospital e-notifications. 42 CFR 482.24(d) applies to hospitals whose system conforms to 45 CFR 170.205(d)(2), which eCFR shows as HL7 2.5.1. Neither the regulation nor the fact sheet names a message type. The routes say hospitals typically send these as HL7 v2 ADT messages; that is an inference from the rule's subject (admission, discharge and transfer events) and common practice, not a statement in a source read today. The hospital route's summary carries the rule's qualifiers: the hospital makes a reasonable effort to reach the listed recipients, and sends only where applicable law allows and not inconsistent with the patient's expressed privacy preferences. The CoP lets a hospital send notifications directly or through an intermediary, which is why the HIE route cites it.
- The Patient Access API compliance date in CMS-9115-F (January 1, 2021) is history and is not repeated in route text.

## Link check

`python3 analysis/networks_link_check.py` on 2026-11-06 reported no dead links. Blocked (HTTP 403 to the bot user agent) and checked by hand: carequality.org, the DirectTrust pages, and oracle.com's QHIN page (which returned 200 to a browser user agent when it was read).

## State and multi-state networks

The state pass adds state HIEs and multi-state networks in four regional batches. This section is written batch by batch; each batch appends its own subsection.

### Batch 7a: Northeast (CT, ME, MA, NH, RI, VT, NJ, NY, PA), read on 2026-11-06

Pages were fetched with curl (`curl -sSL`, browser user agent) and converted to text locally, or with WebFetch where curl failed. Pennsylvania gets full detail; the other states get the basic level (an entry with its website, a how-to-join sentence and sources, and no route list).

#### Pennsylvania evidence bar

A route is attached to a Pennsylvania network only when one of two sources says that network offers the service: the network's own page, or a row of the Pennsylvania Department of Human Services (DHS) table of P3N certified HIOs. The DHS table is a spreadsheet published on the DHS Choose Your HIO page (`ehealth-choose-your-hio.xlsx`, marked "Table Last Updated: 02-27-2025"). DHS says the information comes from questionnaires the HIOs completed and tells providers to contact each HIO for current information, so a table row is the HIO's own answer as published by the state, not a state finding. Menus, audience lists and general explanations of what an HIE is do not count, the same bar the national pass used for QHINs.

Networks placed in Pennsylvania by a primary source: the PA Patient and Provider Network (P3N), which the DHS eHealth Partnership runs, and the HIOs the DHS eHealth for Providers page names as P3N HIO members: Central PA Connect HIE, ClinicalConnect HIE, HealthShare Exchange, KeyHIE and Lehigh Valley Health Network.

Attachments, with the statement behind each:

- P3N. Treatment records: DHS eHealth for Providers and HIO Connection pages, which say the P3N helps providers find their patients' medical records in real time anywhere on the P3N network (paraphrased). Encounter alerts: DHS eHealth for Providers, "The P3N operates a statewide alerting service using real-time admission discharge transfer (ADT) messages". Public health: DHS Public Health Gateway page, the PHG "provides a single, secure connection through which authorized agencies that participate in the Pennsylvania Patient and Provider Network (P3N) can report, query, and share data with the commonwealth's health data systems". Community referral is not attached to the P3N: the DHS PA Navigate page sends healthcare organizations to their HIO, not to the P3N.
- Central PA Connect HIE. Its site (centralpaconnect.org) returns a bot-challenge page with no content to curl and WebFetch, so every attachment rests on the DHS table: "Provider-to-provider clinical: Yes" and a longitudinal medical record (treatment records); HIO-level ADT alerts "Yes for hospital emergency department, hospital inpatient, long term care admissions, discharges, and transfers" (encounter alerts); Public Health Gateway connection "Yes - Active connections to PA State Immunization Registry (PA-SIIS), Prescription Drug Montering [sic] Program (PDMP) and Electronic Lab Reporting (ELR)" (public health); "PA Navigate connection to the state-wide Resource and Referral Tool network" (community referral).
- ClinicalConnect HIE. Its Services page: "ClinicalConnect HIE offers the longitudinal patient record" with "Query and retrieve access to trusted external partner data" (treatment records); "offers a real-time, secure service to notify healthcare providers of encounters at an emergency department or hospital" (encounter alerts); "offers integration to PA Navigate, the statewide community information network" and "Easily make referrals to community-based organizations" (community referral). Public health from the DHS table: "Yes, currently connected to Electronic Reportable Labs (ELR)."
- HealthShare Exchange. Its All Available Services page: the Clinical Data Repository, where members "can see encounters, patient problems, medications procedures, Continuity of Care Documents (CCDs), lab results" from direct members, the P3N and eHealth Exchange (treatment records); the Encounter Notification Service, where members "receive notifications when these patients have had encounters" (encounter alerts). Its Public Health page lists "Electronic Lab Reporting (ELR) feeds to local and state agencies" and eICR reporting, and says HSX "is expanding ELR feeds to include many mandatory reportable conditions"; the DHS table row reads "Currently connected to Electronic Reportable Labs (ELR), Immunizations Registry, Cancer Registry" (public health). Its PA NAVIGATE page: organizations can "Use the PA Navigate platform to electronically refer individuals to an identified Community Based Organization" and know "when the CBO has closed the loop" (community referral).
- KeyHIE. Its P3N page: "KeyHIE Portal users, are also able to manually query P3N for patients with whom they have a Treatment relationship" (treatment records), and on state registries, "KeyHIE currently participates in all available registries" (public health). Its Notifications and Information Delivery Service page: providers "subscribe to receive real-time alerts", including inpatient and emergency admission and discharge notifications (encounter alerts). Community referral is not attached to KeyHIE (removed in the state pass first revision): its PA Navigate page is written mostly in the future tense ("This platform will serve as a system", "expected to be in production in 2023"), the DHS table row for KeyHIE does not mention PA Navigate, and the DHS PA Navigate page, rechecked on 2026-11-06, sends healthcare organizations to "your respective Health Information Organization" without naming KeyHIE. No current KeyHIE or DHS page was found that states the connection in the present tense.
- Lehigh Valley Health Network. lvhn.org is a hospital system site with no page about its HIO service, so every attachment rests on the DHS table: "Provider-to-provider clinical: Yes" and a longitudinal medical record (treatment records); "Active care coordination services: YES- ADT notificaiton [sic] to Primary care providers" and "P3N ADT" (encounter alerts); Public Health Gateway connection "Yes" (public health). Its "HIO-level ADT" cell lists registries instead of alert types and was not relied on. No statement on community referral, so that route is not attached.

New routes, added because Pennsylvania sources support them:

- `public-health-state-hie`. Sources: the DHS Public Health Gateway page, KeyHIE's P3N page and HSX's Public Health page.
- `community-referral-hie`. Sources: the DHS PA Navigate page ("Healthcare organization interested in participating in the PA Navigate network, please reach out to your respective Health Information Organization"), and the HSX and ClinicalConnect pages quoted above (the KeyHIE page was dropped in the first revision). The route text describes a statewide referral tool generically, says only some HIEs and states have one, and names PA Navigate as the cited example.

`treatment-records-state-hie` and `encounter-alerts-state-hie` now link to the Pennsylvania connectivity ledger.

HealthShare Exchange is typed `multi_state` with PA, NJ and DE. Its All Available Services page says it supports "data exchange across the state of Pennsylvania, in Delaware, New Jersey", its Vision page names the Philadelphia tri-state region (Pennsylvania, Delaware, New Jersey), and the DHS table lists New Jersey counties among those it covers. The South batch should extend this entry rather than add a second HSX entry for Delaware.

Not added as Pennsylvania networks: the Delaware Health Information Network (DHIN) and the Chesapeake Regional Information System for our Patients (CRISP). The DHS page says the P3N ADT Service exchanges alerts with both for patients who cross state lines, which is a connection to the P3N, not operation in Pennsylvania. They belong to the South batch.

#### Basic-level entries

- CT: Connie (conniect.org; how to join from its Connect with Connie page). Connie's own page calls itself the state designated HIE; no Connecticut state page was read, so the data file does not state designation.
- ME: HealthInfoNet (hinfonet.org; how to join from its Inquiries page).
- MA: Mass HIway (masshiway.net; how to join from its Enroll page). mass.gov returned HTTP 403 to curl, so no mass.gov page is cited.
- VT: VITL (vitl.net). Its site gives contact details but no joining steps, so its how-to-join sentence is the fallback.
- NJ: New Jersey Health Information Network (NJHIN), cited from the New Jersey Department of Health page nj.gov/health/njhin, which describes the network and says NJII supports onboarding on the Department's behalf. njhin.org returns HTTP 200 but is a parked domain that redirects to a lander page, so it is not cited. HealthShare Exchange also lists New Jersey.
- NY: the SHIN-NY, from the New York eHealth Collaborative (NYeC) pages, plus each regional network the NYeC Connect and Use page lists and links: Bronx RHIO, HealtheConnections, HEALTHeLINK, Healthix, Hixny and Rochester RHIO. Rochester RHIO's own page says it is transitioning its exchange services to HealtheConnections; it is kept because NYeC still lists it. health.ny.gov returned HTTP 403, so no New York State page was read and the data file does not state that any New York entity is state designated. NYeC's statistics (hospital coverage, outcome percentages) are not repeated.

#### Omitted states

- NH: no entry. nhhio.org, the domain of the New Hampshire Health Information Organization created by state law in 2011, does not resolve, and no current New Hampshire state page or network page describing a statewide HIE was found. Search results were press coverage from 2011 to 2013. Rechecked in batch 7d: still no entry (see Batch 7d).
- RI: no entry. CurrentCare, run by the Rhode Island Quality Institute, could not be read: currentcareri.org fails the TLS handshake to curl and WebFetch, riqi.org serves a certificate for another host, and health.ri.gov returns HTTP 403 behind a bot challenge. A later batch or the monthly check should retry; the research rules do not allow citing a page that was not read. Retried in batch 7d with the same result (see Batch 7d).

#### Pages that could not be read

centralpaconnect.org (bot challenge, empty page; the link check still records HTTP 200), currentcareri.org and riqi.org (TLS errors), health.ri.gov, mass.gov and health.ny.gov (HTTP 403), nhhio.org (DNS), njhin.org (parked).

### Batch 7b: South (DE, MD, DC, VA, WV, NC, SC, GA, FL, KY, TN, AL, MS, AR, LA, OK, TX), read on 2026-11-06

Pages were fetched with curl (`curl -sSL`, browser user agent) and converted to text locally. Where curl got HTTP 403 and WebFetch could read the page, WebFetch was used and the page is named below. Every entry is at the basic level: website, a how-to-join sentence taken from the network's own site (or the fallback sentence where the site gives no joining steps), sources, and no route list. A state agency page is cited where one was read; designation is described here only where a state page says it, and the data file never states designation outside a source title.

#### Route wording fix

`treatment-records-state-hie` said its standard "is stated on its entry", but network entries have no standard field. The standard now reads: query-based exchange, and directed exchange where the HIE offers it, with technical standards that differ from one HIE to the next, so the reader checks the network's own site. ASTP/ONC's What is HIE? page, already cited on the route, names the two forms (directed and query-based exchange). No source read today says that state HIEs in general use a particular IHE profile or HL7 v2 feeds, so the route names neither.

#### CRISP and CRISP Shared Services

CRISP's own pages describe CRISP as the State Designated HIE for Maryland and "the regional health information exchange of Maryland", and name no other state it serves directly, so its entry lists MD only. The Maryland Health Care Commission HIE page refers to "the State-Designated HIE (CRISP)". The CRISP DC About page says CRISP DC is an affiliate of CRISP Shared Services "while operating as an independent District governed entity", and names the other affiliates as CRISP Maryland, West Virginia Health Information Network, HealtheConnect Alaska and Virginia Health Information. Each affiliate in this batch is its own entry under its own name and state. CRISP Shared Services itself gets no entry: its site describes a nonprofit that shares technology with affiliates and lists no exchange an organization joins. WVHIN's About page says it joined CRISP Shared Services in 2016 as its technology infrastructure partner; SCeHA's home page says it runs on the CRISP Shared Services platform; the Florida HIE's About page says CRISP Shared Services manages the day-to-day operations of its services. Alaska belongs to another batch.

#### Basic-level entries

- DE: Delaware Health Information Network (DHIN). Its About page says the Delaware General Assembly established it in 1997. HealthShare Exchange already lists DE from batch 7a and was not changed.
- MD: CRISP (see above).
- DC: CRISP DC and Capital Partners in Care Health Information Exchange (CPC-HIE). The DC Department of Health Care Finance (DHCF) DC HIE page lists Chesapeake Regional Information System for our Patients, Inc. DC as the District Designated HIE Entity and as a District Registered HIE Entity, and lists the District of Columbia Primary Care Association (CPC-HIE) as a District Registered HIE Entity. CPC-HIE has no site of its own; its entry cites the DC Primary Care Association program page (dated 2021 in substance) and uses DCPCA's home page as the website. Neither page gives joining steps, so its how-to-join sentence is the fallback.
- VA: Virginia Health Information (VHI). ConnectVirginia's domain now redirects to VHI's HIE page. VHI's own page calls it Virginia's designated statewide HIE; no Virginia agency page was read, so the data file does not state designation.
- WV: West Virginia Health Information Network (WVHIN).
- NC: NC HealthConnex, run by the N.C. Health Information Exchange Authority on an official State of North Carolina site that calls it the state-designated health information exchange.
- SC: South Carolina e-Health Alliance (SCeHA). schiex.org now redirects to sceha.org. Its home page calls it South Carolina's statewide HIE, operated by Health Sciences South Carolina; no South Carolina agency page was read.
- GA: Georgia Health Information Network (GaHIN). GaHIN's Join page says its members include regional HIEs; those were not enumerated, because no Georgia agency page listing them was read (dch.georgia.gov returned 404 at the path tried).
- FL: Florida Health Information Exchange. Its own page says the Agency for Health Care Administration governs it; no AHCA page was read (ahca.myflorida.com returned 404 at the path tried), so the data file does not state designation.
- KY: Kentucky Health Information Exchange (KHIE), on an official Commonwealth of Kentucky site.
- TN: Tennessee Health Information Exchange (TnHIE), formerly etHIN (ethin.org redirects to tnhie.org). Its page says it is based in Knoxville and continues to expand statewide; the entry lists TN only. No Tennessee agency page was read.
- MS: IntelliTrue HIE, described on the Mississippi Hospital Association page that intellitrue.org redirects to.
- AR: SHARE (Arkansas State Health Alliance for Records Exchange). Its Join page gives the Arkansas Department of Health, Office of Health Information Technology as its contact; healthy.arkansas.gov returned HTTP 403, so no other state page is cited.
- LA: Louisiana Health Information Exchange (LaHIE), from the Louisiana Health Care Quality Forum's HIE Platform page. No joining steps there, so the fallback sentence is used.
- OK: MyHealth Access Network. The Oklahoma Health Care Authority OKSHINE overview says the Office of the State Coordinator for HIE within OHCA oversees the state-designated entity for HIE, MyHealth Access Network.
- TX: HIETexas (Texas Health Services Authority), C3HIE, Healthconnect Texas, Connected Care Exchange (doing business as Rio Grande Valley Health Information Exchange) and Connxus. The Texas Health and Human Services Commission Statewide Health Information Exchange page (HTTP 403 to curl, read with WebFetch) lists C3HIE, Healthconnect Texas and Connected Care Exchange as contracted local HIEs and names THSA's state-level platform, HIETexas. THSA's own HIETexas page says HIETexas is the state-level health information network THSA operates under Chapter 182 of the Texas Health and Safety Code. THSA's HIE Connectivity page lists C3HIE, Connected Care Exchange, Connxus and Healthconnect Texas as regional HIEs participating in HIETexas. THSA's list is cited as a secondary source on those regional entries, since THSA is not a state agency. Healthconnect Texas says it and Patient Care Intervention Center are now one organization; ghhconnect.org (Greater Houston Healthconnect) redirects to it. Connected Care Exchange's only joining text is a membership event dated March 2025, so its sentence is the fallback.

#### Omitted states and candidates

- AL: no entry in this batch, because the site could not be read. One Health Record (onehealthrecord.alabama.gov), which search results describe as run by the Alabama Medicaid Agency, returns HTTP 403 behind a bot challenge to curl and fails certificate verification in WebFetch; medicaid.alabama.gov timed out to curl and failed certificate verification in WebFetch. Resolved in batch 7d: One Health Record was added from its policy manual (see Batch 7d).
- MS: the Mississippi Health Information Network (MS-HIN) gets no entry; ms-hin.org does not resolve and no current page was found.
- LA: the Greater New Orleans Health Information Exchange gets no entry; gnohie.org serves a certificate for another host.
- TX: PHIX, which THSA lists as a regional HIE, gets no entry; its site was not found at the domains tried.

#### Pages that could not be read

onehealthrecord.alabama.gov (HTTP 403, bot challenge; certificate error in WebFetch), medicaid.alabama.gov (timeout; certificate error in WebFetch), ms-hin.org (DNS), gnohie.org (certificate for another host), healthy.arkansas.gov (HTTP 403), hhs.texas.gov (HTTP 403 to curl with the user agent used for reading; read with WebFetch; the link check, which sends a different user agent, got a success status). The link check also reported the Maryland Health Care Commission HIE page as HTTP 403, although curl read it during research; it is listed for checking by hand.

### Batch 7c: Midwest (IL, IN, MI, OH, WI, IA, KS, MN, MO, NE, ND, SD), read on 2026-11-06

Pages were fetched with curl (`curl -sSL`, browser user agent) and converted to text locally; WebFetch was tried where curl failed, and the pages it also could not read are listed below. Every entry is at the basic level, as in batch 7b. Designation is described here only where a state page says it; the data file never states designation outside a source title.

#### KONZA Health affiliates

KONZA Health's home page lists the networks it serves, among them the Kansas Health Information Network (KHIN) and SHINE of Missouri. Each has its own site, which describes it as a health information exchange powered by KONZA Health: KHIN was founded by the Kansas Medical Society and the Kansas Hospital Association, and SHINE is delivered in partnership between the Missouri State Medical Association and KONZA Health. Both describe a state HIE service distinct from KONZA's QHIN service, so each gets its own state entry. `qhin-konza-health` (national, no states) was not changed. KONZA's list also names affiliates in states from earlier batches; those were not added or changed here.

#### Iowa: CyncHealth to Converge Health Iowa

The Iowa Department of Health and Human Services Health Information Exchange Transition FAQ (a PDF) says Iowa HHS announced in December 2025 that it would move HIE services from the former vendor, CyncHealth Iowa, to Converge Health Iowa, a nonprofit that submitted the winning proposal. CyncHealth's "Our Work in Iowa" post (dated May 6, 2026) says its time serving Iowa as the HIE concluded on May 6, 2026. CyncHealth's Participants page still lists Iowa organizations, but because its own later post says it no longer serves Iowa, the CyncHealth entry lists NE only, and Iowa's entry is Converge Health Iowa. Converge's home page calls itself Iowa's designated statewide HIE; the Iowa FAQ calls it the new vendor, so the data file does not state designation.

#### South Dakota Health Link

South Dakota Health Link is a South Dakota Department of Health program (the DOH program page links to sdhealthlink.org). Its own site lists participating members under South Dakota, Wyoming, Minnesota, Iowa, North Dakota and Nebraska, so it is one `multi_state` entry listing all six states, following the HealthShare Exchange precedent. Wyoming belongs to another batch. No South Dakota page read today uses the word designated, so the data file does not state designation.

#### Basic-level entries

- IL: no entry (see below).
- IN: Indiana Health Information Exchange (IHIE). Its About page calls it a designated Health Data Utility without naming who designated it; no Indiana agency page was read. Its site offers only a contact form, so its how-to-join sentence is the fallback.
- MI: MiHIN. Its Who We Are page says Michigan formalized MiHIN as the state designated HIE; no michigan.gov page was read, so the data file does not state designation. gl-hc.org redirects to a MiHIN page saying Great Lakes Health Connect became fully integrated into MiHIN on June 30, 2021, so GLHC gets no entry.
- OH: CliniSync, run by the Ohio Health Information Partnership.
- WI: WISHIN. Its About page calls it Wisconsin's state-designated entity for HIE; no Wisconsin agency page was read.
- IA: Converge Health Iowa (see above). The Iowa HHS FAQ is cited as a state source.
- KS: Kansas Health Information Network (KHIN), plus Lewis and Clark Information Exchange (below). KHIN's contact page returned 404 and its home page offers a demo request and contact form only, so its how-to-join sentence is the fallback.
- MN: Koble-MN. The Minnesota Department of Health Certified HIOs page lists The Koble Group, LLC d/b/a Koble-MN as a certified health information organization, certified through May 15, 2027. South Dakota Health Link also lists Minnesota members.
- MO: SHINE of Missouri, Velatura HIE Corporation, and Lewis and Clark Information Exchange. Velatura's HIE page says the Missouri TDSO evolved from Midwest Health Connection (formerly Missouri Health Connection) and that Velatura HIE Corporation manages it; Velatura's Missouri Consent page describes Velatura as a health information exchange that lets participating providers share records. The same Velatura page names GRAChIE, a separately named statewide exchange in Georgia, and a Florida TDSO it describes as being built; neither was added in this batch, so Velatura's entry lists MO only. Velatura's page lists an Illinois TDSO as "coming soon", which is not an operating network. Neither SHINE, Velatura nor LACIE gives joining steps, so all three use the fallback sentence.
- KS and MO: Lewis and Clark Information Exchange (LACIE), one `multi_state` entry. Its About page says it was the first HIE to share data in both Kansas and Missouri, with a focus on the greater Kansas City region.
- NE: CyncHealth (see above).
- ND: North Dakota Health Information Network (NDHIN), on an official State of North Dakota site. Its access page covers individual user agreements, not how an organization joins, so its how-to-join sentence is the fallback.
- SD: South Dakota Health Link (see above).

#### Omitted states and candidates

- IL: no entry, because no current statewide or regional HIE could be sourced. hie.illinois.gov (the former Illinois Health Information Exchange portal) returns HTTP 404. The Illinois Department of Healthcare and Family Services runs HealthChoice Illinois ADT, a statewide Medicaid data exchange platform that its HFS page says delivers admission, discharge and transfer notifications to Medicaid providers. It was not added as a basic `state_hie` entry, because under the map rule a basic state HIE entry shades every state HIE route on the map, including treatment records and public health, which this platform's page does not describe. It could be added later as a full entry carrying only the encounter alerts route. Rechecked in batch 7d: still no entry (see Batch 7d).
- IN: the Michiana Health Information Network gets no entry; mhin.org redirects to a domain-for-sale page. HealthLINC gets no entry; healthlinc.org returns 404.
- OH: HealthBridge gets no entry; healthbridge.org returned HTTP 403, and The Health Collaborative's site describes no HIE service today.
- MO: the Tiger Institute for Health Innovation gets no entry; tigerinstitute.org does not resolve. Search results describe a Missouri Department of Social Services page listing contracted Health Information Networks, but that page could not be read (below), so no Missouri state source is cited.
- NE: none omitted.

#### Pages that could not be read

dss.mo.gov/mhd/hie.htm (HTTP 404 to curl and WebFetch), dss.mo.gov/mhd/hie-onboarding/ (HTTP 404 in WebFetch), missourihealthconnection.org (TLS handshake failure; HTTP 409 over http), hhs.iowa.gov/health-information-exchange (HTTP 404; the transition FAQ PDF was read instead), hie.illinois.gov (HTTP 404), mhin.org (parked), healthlinc.org (HTTP 404), tigerinstitute.org (DNS), healthbridge.org (HTTP 403), khinonline.org/contact-us/ (HTTP 404).

### Batch 7d: West (AZ, CO, ID, MT, NV, NM, UT, WY, AK, CA, HI, OR, WA) and retries (NH, RI, AL, IL), read on 2026-11-06

Pages were fetched with curl (`curl -sSL`, browser user agent) and converted to text locally; WebFetch was tried where curl failed. Every entry is at the basic level, as in batches 7b and 7c. Designation is described here only where a state page says it; the data file never states designation outside a source title.

#### Contexture (Arizona and Colorado)

Contexture's About Us page says it is the statewide health information exchange for both Arizona and Colorado, and its HIE onboarding page addresses participants of the Contexture HIE in Arizona and Colorado, so it is one `multi_state` entry listing AZ and CO. Quality Health Network's home page says QHN is now Contexture and that the legacy QHN platform has been retired, so QHN gets no entry of its own; its page is cited on the Contexture entry. Contexture's Get Connected link leads to its contact page, so its how-to-join sentence is the fallback. No Arizona or Colorado agency page was cited: the AHCCCS Health Information Exchange page returns HTTP 200 with a "Page/Document not found" body, and the Colorado Office of eHealth Innovation home page was read but does not name Contexture.

#### Reliance eHealth Collaborative

Reliance's Community Partners page says it was founded in Southern Oregon in 2011 and now serves Oregon, Washington, and parts of Northern California, so it is one `multi_state` entry listing OR, WA and CA. reliancehie.org/about-reliance/ returns 404; the description is read from the About text served on the Community Partners page. No Oregon agency page was read.

#### California

The CalHHS Data Exchange Framework (DxF) "QHIOs at a Glance" PDF, last updated June 2026, lists the Qualified Health Information Organizations (QHIOs); the DxF site defines a QHIO as a DxF designated intermediary. The PDF says its data are self-reported by the QHIOs and not independently verified by the DxF Program, so it is cited for the list only, not for the counties each organization serves. Entries were added for the QHIOs whose own sites were read and describe a health information exchange an organization joins: Manifest MedEx, SacValley MedShare and San Diego Health Connect. The others were not added:

- Health Gorilla is already present as the national entry `qhin-health-gorilla`, with no states; a national entry is not extended with a state list.
- Cozeva (Applied Research Works) and Long Health: their own home pages describe software products (quality and risk adjustment; AI summarization and data transformation), not a network an outside organization joins. They may be added if they describe a network an outside organization joins.
- Los Angeles Network for Enhanced Services (LANES): lanesla.org returns HTTP 403 behind a bot challenge to curl and WebFetch.
- Orange County Partners in Health HIE: the state PDF gives ocphhiestg.wpengine.com, a staging host, as its website; that page carries a 2022 copyright and no production domain was found, so no staging URL is published.

An earlier 2023 DxF PDF named one more QHIO, Serving Communities Health Information Organization; it is not on the June 2026 list and was not added.

#### Basic-level entries

- AZ, CO: Contexture (see above).
- ID: Idaho Health Data Exchange (idahohde.org; idhde.org does not resolve). Its Join the Network link leads to a contact form, so its how-to-join sentence is the fallback. No Idaho agency page was read.
- MT: Big Sky Care Connect (mtbscc.org; bigskycareconnect.org does not resolve). Executive Order 14-2019, on the State of Montana former governors site, designates Big Sky Care Connect as Montana's single, state-designated health information exchange entity; a 2022 Governor's Office release describes state investment in it. Its site gives no joining steps, so the fallback is used.
- NV: HealtHIE Nevada. How to join from its Sign Up / Learn More page. dhhs.nv.gov reset the connection, so no Nevada agency page is cited.
- NM: SYNCRONYS (www.syncronys.org; the bare domain fails the TLS handshake). Its home page calls it the operator of the state's designated HIE; no New Mexico agency page was read, so the data file does not state designation. Fallback join sentence.
- UT: UHIN Clinical Health Information Exchange (CHIE). UHIN also runs a claims clearinghouse; the entry covers the CHIE. Its Let's Connect link is a sales form, so the fallback is used. No Utah agency page was read.
- WY: Wyoming Frontier Information (WYFI), separately sourced from South Dakota Health Link, which already lists WY. The Wyoming Department of Health WYFI page describes WYFI as the statewide HIE the Department administers and links wyfi.solutions as the official site. How to join from the Join Now form on the WYFI Providers page. Search results describe a 2026 state procurement for a new WYFI build; that was not read on a state page and is not stated in the data file.
- AK: healthEconnect Alaska (healtheconnectak.org; healthiealaska.org does not resolve). The Alaska Department of Health For Health Care Facilities page says it is designated as Alaska's HIE by the Department. How to join from its Provider FAQs.
- CA: Manifest MedEx, SacValley MedShare, San Diego Health Connect (see above), plus Reliance eHealth Collaborative. How to join for San Diego Health Connect is from its FAQ; the other two use the fallback.
- HI: Hawaii Health Information Exchange. Its home page calls it the state-designated HIE; no Hawaii agency page was read. Fallback join sentence.
- OR: Reliance eHealth Collaborative (see above). How to join from the FAQ text served on its home page, which gives a phone number and email address (reliancehie.org/faq/ returns 404).
- WA: OneHealthPort HIE, plus Reliance. How to join from its Contracting page, which describes a participation agreement signed online and an annual subscription fee; fee amounts are not repeated. No Washington agency page was read (the Health Care Authority HIE path tried returned 404).

#### Retries for NH, RI, AL and IL

- NH: still no entry. nhhio.org now resolves, but to an unrelated online gambling site, so the New Hampshire Health Information Organization's domain has lapsed. www.dhhs.nh.gov returned HTTP 403. A web search found no current page from a New Hampshire network or agency describing a statewide HIE. Nothing in the data file links nhhio.org.
- RI: still no entry. currentcareri.org and www.currentcareri.org fail the TLS handshake to curl and WebFetch; riqi.org and www.riqi.org serve a certificate for another host (WP Engine) to curl and WebFetch; eohhs.ri.gov returns a bot challenge (HTTP 403). The pages were not read with certificate checks disabled, and a site that fails certificate verification could not pass the link check anyway.
- AL: added. The One Health Record home page still returns HTTP 403 behind a bot challenge, but its policy manual PDF on the same domain (effective October 1, 2023; file created March 2024) was read with curl. It calls One Health Record Alabama's Health Information Exchange, says it is administered and managed by the Alabama Medicaid Agency, and says each participant must execute a DURSA (participation agreement) and a HIPAA Business Associate Agreement before exchange begins; the how-to-join sentence comes from that. The Alabama Medicaid Agency home page, read with curl, links "One Health Record - HIE" to onehealthrecord.alabama.gov. A 2015 Medicaid news item about One Health Record was read but is not cited, because it does not show current operation. The entry's website is the One Health Record home page, which the link check lists for checking by hand.
- IL: still no entry. The HFS HealthChoice Illinois ADT page still loads; hfs.illinois.gov/medicalproviders/ehealth.html and the IDPH health information exchange path tried return 404, and the former www2.illinois.gov HIE site redirects to the illinois.gov home page. No page found describes a current statewide or regional HIE an outside organization can join, so the batch 7c reasoning stands.

#### Pages that could not be read

lanesla.org (HTTP 403, bot challenge, also in WebFetch), ocphhiestg.wpengine.com (read, but a staging host; not cited), azahcccs.gov HIE page (HTTP 200 with a not-found body), dhhs.nv.gov (connection reset), syncronys.org without www (TLS handshake failure), idhde.org, bigskycareconnect.org and healthiealaska.org (DNS), reliancehie.org/about-reliance/ (HTTP 404), hca.wa.gov HIE path tried (HTTP 404), dxf.chhs.ca.gov QHIO list PDFs at the 2023 and 2025 upload paths (HTTP 404; the June 2026 PDF under /wp-content/uploads/sites/6/ was read instead), currentcareri.org and riqi.org (TLS errors), eohhs.ri.gov and www.dhhs.nh.gov (HTTP 403), nhhio.org (unrelated gambling site), onehealthrecord.alabama.gov pages other than the policy manual PDF (HTTP 403 or timeout).

#### Link check

No dead or unreachable links. The check-by-hand list is the batch 7c list plus one new item: the One Health Record home page (HTTP 403, bot challenge).

#### Coverage after the state pass

Every jurisdiction has at least one local or multi-state entry except IL, NH and RI. This is not a claim that the networks listed are the only ones operating in any state.

### State pass first revision, 2026-11-06

- `public-health-state-hie` and `community-referral-hie`: the summaries described Pennsylvania's Public Health Gateway and PA Navigate as if every state had one. Under the map rule, every basic `state_hie` and `multi_state` entry shades these routes as pending, so the wording now says that some states and some HIEs offer the connection, where the state runs one, and names Pennsylvania as the cited example. `who_can_use` and `how_to_join` say not every state or HIE offers it. Sources are unchanged except that the KeyHIE PA Navigate page was removed from the community referral route.
- KeyHIE: the `community-referral-hie` attachment and its PA Navigate source were removed (see the KeyHIE note under the Pennsylvania evidence bar).
- Reliance eHealth Collaborative: the how-to-join sentence pointed at an FAQ page; reliancehie.org/faq/ returns 404. It now points at the home page, which is the cited source and carries the phone number and email address in its FAQ text.
- One Health Record (AL): the first-revision automated recheck could not re-read the One Health Record domain (HTTP 403 bot challenge to curl; certificate error in WebFetch). The entry is kept. Its how-to-join sentence comes from the policy manual PDF read during batch 7d and should be checked by hand against the current One Health Record site.
