---
title: Phase 10 - Agentic Workflow and Human Approval
date: 2026-08-17
tags:
  - herms
  - roadmap
  - agents
  - human-in-the-loop
status: future
---

# Phase 10: Agentic Workflow and Human Approval

## Goal

Add useful agent assistance without allowing an AI system to bypass HERMS authorization, financial controls, stock controls, or business rules.

## Why This Comes Last

Agentic workflow is not currently defined in the SRS. An agent can only be trusted after the deterministic workflows, permissions, audit events, idempotency, and operational recovery paths from Phases 0–9 are stable.

## Prerequisites (Inputs from Phases 0–9)

- Stable deterministic workflows, audit log, permissions, event history, and operational metrics — plus client approval and a change request for agentic scope.

## Recommended Rollout

### Stage 1: Read-only Assistance

- Summarize pending approvals and overdue returns.
- Answer dashboard questions using authorized, filtered data.
- Identify unusual missing/damaged patterns as recommendations.

### Stage 2: Human-approved Drafts

- Draft customer and staff reminders.
- Draft quotations using prices returned by deterministic pricing services.
- Suggest collection or approval priorities.
- Require a user to review and send every draft.

### Stage 3: Bounded Workflow Actions

- Allow the agent to request an allowlisted backend command.
- Require explicit human approval for every sensitive mutation.
- Re-run authorization and business-rule validation at command execution time.
- Keep a manual fallback for every action.

## Prohibited Direct Agent Actions

An agent must not directly modify:

- Stock quantities or stock approvals.
- Prices or price escalation records.
- Payments or customer balances.
- Damage claims or write-offs.
- User roles or permissions.
- Note approvals, reopening, or reversal decisions.

## Required Safety Controls

- Agents call allowlisted backend APIs, never Neon PostgreSQL directly.
- Backend authorization and BR-1 through BR-6 remain mandatory.
- The agent cannot approve its own recommendation.
- Store, role, and customer-data permissions are enforced server-side.
- Audit records include user, agent, model/version, tool calls, recommendation, final decision, and resulting mutation.
- Agent-triggered tasks use idempotency keys, bounded retries, and SQS dead-letter handling where asynchronous.
- Sensitive data is minimized and prompt-injection defenses are applied.
- Low-confidence or failed actions fall back to manual processing.

## Requirements Traceability

Agentic workflow is a proposed future capability and is not a current SRS requirement. It must be added through an approved change request. It must preserve:

- FR-7.5: approval auditability.
- FR-9.6 and FR-9.7: Finance confirmation and immutable pricing history.
- FR-12.1 to FR-12.3: role and action attribution.
- BR-1 through BR-6: deterministic business rules.

## Pilot Acceptance Criteria

- Agents cannot mutate stock, prices, balances, claims, or approvals without an authorized human action.
- Every recommendation links to the source records used to produce it.
- Unauthorized or cross-store data requests are rejected.
- Retries cannot duplicate a business effect.
- Manual processing remains available for every agent-assisted workflow.
- Pilot results demonstrate acceptable accuracy, audit completeness, and safe failure behavior.

## Outputs

- Read-only assistance first; bounded automation only after production evidence and client approval.

## Delivery Priority

**Later / optional.** Start with read-only assistance and expand only after production evidence, client approval, and a dedicated agentic-workflow change request.
