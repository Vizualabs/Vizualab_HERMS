---
title: Phase 9 - Hardening and Could-haves
date: 2026-08-17
tags:
  - herms
  - roadmap
  - hardening
  - nfr
status: implementation-complete-deployment-validation-pending
---

# Phase 9: Hardening and Could-haves

## Goal

Verify non-functional requirements, ship low-priority features, and rehearse operational procedures before and after launch.

## Prerequisites (Inputs from Phases 0–8)

- All MVP features implemented and the dashboard live.

## Scope

- Reorder threshold alerts (FR-6.4, priority `C`).
- Printed DN/RN layouts matched to the client's paper forms (§10.2, §11.1, §11.2).
- Load test against the 3-second dashboard and 2-minute mobile-form NFRs (§6.1, §6.4).
- Audit-trail completeness review: every stock movement, price change, discrepancy, and payment traceable to a source document and user (§6.6).
- Uptime instrumentation against the 99.5% target (§6.3).
- Database-resident backup/restore is excluded by the product owner while the project uses
  limited Neon free-tier storage. No backup tables, snapshots, or copied transaction data are
  implemented in Phase 9.

## Explicitly Out of Scope for v1 (§10.1)

- Customer self-service portal.
- Barcode/RFID counting.
- Multi-branch consolidation.
- Accounting integration.

Keep the schema multi-store-ready (§6.5) without building it.

## Outputs (Handoff to Phase 10)

- A hardened and measurable system ready for deployment validation and optional agentic assistance.

## Implementation status (2026-08-30)

- Reorder thresholds, deduplicated low-stock episodes, stock UI indicators, audit events, and
  Store Admin/deputy notification outbox events are implemented.
- SRS-based DN/RN PDF layouts and authenticated downloads are implemented. Exact coordinate
  matching remains a presentation-only deployment follow-up when client paper samples exist.
- Audit completeness and read-only dashboard load verifiers are implemented.
- Storage-neutral request SLO logs and CloudWatch 99.5% availability / dashboard p95 alarms are
  implemented in infrastructure code.
- Staging load results, representative-user mobile timing, alarm delivery, and production
  deployment are pending the separate deployment phase requested by the product owner.

## Delivery Priority

**Should have / hardening.**
