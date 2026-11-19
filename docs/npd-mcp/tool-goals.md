---
title: "Open-source MCP tools for the National Provider Directory"
version: "0.1-draft"
updated: "2026-11-19"
---

## What this is

This is an open working group. Its members implement and test Model Context Protocol (MCP) tools over National Provider Directory (NPD) data. They draft standards for the group to review, and they check the tools against real use cases from apps, payers, providers and vendors. Anyone can join, and joining needs no account.

The long-term aim is one golden record per provider. A provider corrects their information once, and the change is flagged to every organization that holds a copy.

## Why MCP tools, not only FHIR APIs

**What is the difference between an MCP tool and a FHIR API?**
A FHIR API exposes resources and a search syntax. The caller has to know which resources to query and how to join them. An MCP tool is a described task, such as "find this organization's endpoints" or "check whether this NPI is excluded". The tool states its inputs and outputs in plain terms, and it does the joins itself.

**Can one tool use more than one source?**
Yes. A single tool can read the NPD, NPPES, payer directories and the federal exclusion lists, and return one answer. With FHIR APIs alone, each caller writes that combination again, and the copies drift apart.

**Who can call these tools?**
Applications call them the same way AI agents do. An integration engine, a credentialing app and a chat assistant can call the same tool and get the same answer, so a fix lands in one place.

**Does this replace FHIR?**
No. FHIR stays the data format underneath. The tools read FHIR resources and can return them, and the NPD stays the source of record.

**How does a caller know whether to trust an answer?**
Each tool can return its evidence with the answer: which source said what, and the date of that source. A caller can then decide whether a record from three months ago is good enough for the task at hand.

## Tool goals

The steps refer to the directory flow in a proposal shared in the NPD community: `ftrotter-gov/CMSPayerEndpointSeed`, file `docs/npd-how-did-it-go-api.md`. That proposal is a draft, and this page makes no claim about whether CMS will adopt it.

| Goal | NPD flow step | Status | Today |
| --- | --- | --- | --- |
| Discover: find an organization or practitioner and its endpoints | Steps 1 to 2 | Partly available | `lookup_npi`, `lookup_organization` |
| Validate: check status, such as Medicare enrollment, OIG and SAM exclusions, and NPI validity | Step 5 | Partly available | `check_npi_cohort` |
| Report how an exchange went | Step 7 | Proposed | Wraps the proposed NPD Endpoint Feedback API v0.2, with an AINPI sandbox until NPD hosts one |
| Update once, route to everyone | Golden record | Proposed | None yet. This is the hardest goal |

The tools available today run on the AINPI MCP server at `https://ainpi.dev/api/mcp`. The proposed tools do not exist yet. The group will draft and review them first.

## What MCP does not solve

MCP does not settle authentication or trust between organizations. A tool can carry credentials, but the parties still have to agree on who may call what.

MCP does not fix data quality at the source. A tool that reads a wrong address returns that wrong address, with its source attached.

MCP does not decide who may update what. The update goal needs an agreement on which party may change which field, and on how a change is checked before others receive it.

## How the group works

Sign up on this page. The first piece of work is the connectathon: implement and test the tools above against real directory data. Drafts are reviewed in the open on GitHub in `FHIR-IQ/AINPI`. Anyone can propose a use case.

Independent open-source work by AINPI. Not produced, reviewed, or endorsed by CMS or the NPD team.
