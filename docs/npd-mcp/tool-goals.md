---
title: "Open-source MCP tools for the National Provider Directory"
version: "0.2-draft"
updated: "2026-11-22"
---

## What this is

This is an open working group, starting now. Members will implement and test Model Context Protocol (MCP) tools over National Provider Directory (NPD) data, draft specifications for the group to review, and check the tools against use cases that apps, payers, providers and vendors bring. Anyone can join, and joining needs no account.

This is independent open-source work by AINPI. It is not produced, reviewed, or endorsed by CMS or the NPD team.

The long-term aim is that a provider corrects their information once, and every organization that holds a copy is told.

## Why MCP tools, not only FHIR APIs

**What is the difference between an MCP tool and a FHIR API?**
A FHIR API exposes resources and a search syntax. The caller has to know which resources to query and how to join them. An MCP tool is a described task, such as "find this organization's endpoints" or "check whether this NPI is excluded". The tool states its inputs and outputs in plain terms, and it does the joins itself.

**Can one tool use more than one source?**
Yes. `lookup_organization` already combines NDH Endpoint records with EHR vendors' published endpoint lists and labels each endpoint by source. A tool could add NPPES, payer directories and the exclusion lists the same way. With FHIR APIs alone, each caller writes that combination again, and the copies drift apart.

**Who can call these tools?**
Applications call them the same way AI agents do. An integration engine, a credentialing app and a chat assistant can call the same tool and get the same answer, so a fix lands in one place.

**Does this replace FHIR?**
No. FHIR stays the data format underneath, and the NPD stays the source of record. Today's tools read data derived from the NPD's FHIR bulk files. The proposed tools would read FHIR APIs directly and return FHIR resources where a caller wants them.

**How does a caller know whether to trust an answer?**
Each tool should return its evidence with the answer: which source said what, and the date of that source. `lookup_organization` does part of this today: every endpoint carries its source, `ndh` or `vendor_file`, and the response carries the NDH release date. A caller can then decide whether a record from three months ago is good enough for the task at hand.

## Tool goals

The step numbers refer to the numbered flow diagram (`docs/NPD_Query_Flow.png`) in the NPD Endpoint Feedback API proposal, version 0.2, shared in the NPD community: `ftrotter-gov/CMSPayerEndpointSeed`, `docs/npd-how-did-it-go-api.md`. The proposal calls itself an initial design, not an existing NPD API, and this page makes no claim about whether CMS will adopt it.

| Goal | NPD flow step | Status | Today |
| --- | --- | --- | --- |
| Discover: find an organization or practitioner and its endpoints | Steps 1 to 2 | Available | `search_organizations` (by name, optionally within a state), `lookup_organization` (an organization's endpoints, by NPI), `lookup_npi` (a practitioner, by NPI). No practitioner search by name yet |
| Validate: check status, such as Medicare enrollment, OIG and SAM exclusions, and NPI validity | Step 5 | Partly available | `verify_roster` (a list of NPIs, with a key): NDH record and roles, live NPPES status, OIG and SAM exclusions, endpoint reach, each with its source and date. `check_npi_cohort`: the high-risk cohort, as of the last weekly run. No Medicare enrollment check yet |
| Report how an exchange went | Step 7 | Sandbox available | `report_interaction` and `get_interaction_report`, plus `POST` and `GET /api/v1/interaction-reports` on ainpi.dev, following the NPD Endpoint Feedback API proposal, v0.2. An AINPI test service, not an NPD API. Needs a key issued to a working-group participant |
| Update once, route to everyone | Not in the flow | Proposed | None yet. This is the hardest goal |

The tools available today run on the AINPI MCP server at `https://ainpi.dev/api/mcp`. The update tool does not exist yet; the group will draft and review it first.

### The report sandbox

The sandbox follows the [proposal](https://github.com/ftrotter-gov/CMSPayerEndpointSeed/blob/main/docs/npd-how-did-it-go-api.md): the same body, issue vocabulary, timestamp rules, retries and error format. It differs in one place, the reporter reference on the receipt (below). It exists so that requesters and responders can test the proposed format now. No NPD-hosted service exists. Where the proposal leaves a choice open or the sandbox has to differ, it does this:

- The reporting organization is the working-group participant the key was issued to. The receipt names it as `NpdMcpParticipant/<id>`, because the sandbox has no NPD Organization record for it.
- A report with a property the proposal does not define is rejected, so free-form data cannot ride along.
- A report is visible only to the organization that sent it and is deleted 90 days after receipt, the proposal's deduplication window. Nothing is published or aggregated.
- Each key may submit 30 reports a minute and 1,000 a UTC day.
- Two submissions count as the same report when their values are the same after normalizing: property order, `reportId` case and timestamp offsets do not count as a change.
- A retry of a stored report is checked against the thirty-day rule like any submission, so once `endedAt` is more than thirty days old a retry gets `400`; read the receipt with `GET` instead.
- `endpointReference` must name an Endpoint (`Endpoint/<id>`), and `httpMethod` must be a standard HTTP method.

Use test exchanges only. The sandbox cannot check that a description is free of patient data, so never put patient data, credentials or raw payloads in a report.

## What MCP does not solve

MCP does not settle authentication or trust between organizations. A tool can carry credentials, but the parties still have to agree on who may call what.

MCP does not fix data quality at the source. A tool that reads a wrong address returns that wrong address, with its source attached.

MCP does not decide who may update what. The update goal needs an agreement on which party may change which field, and on how a change is checked before others receive it.

## How the group works

Sign up on this page. After a check that the sign-up is genuine, the organization's contact receives an API key by email. The first piece of work is to test the tools above against real directory data at the upcoming NPD community connectathon. AINPI takes part as a participant, not an organizer. The group reviews drafts in the open on GitHub in `FHIR-IQ/AINPI`. Anyone can propose a use case.

Independent open-source work by AINPI. Not produced, reviewed, or endorsed by CMS or the NPD team.
