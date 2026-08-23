---
title: Phase 9 - Hardening and Could-haves
date: 2026-08-17
tags:
  - herms
  - roadmap
  - hardening
  - nfr
status: draft
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
- Backup/restore rehearsal on Neon with documented RPO/RTO.

## Explicitly Out of Scope for v1 (§10.1)

- Customer self-service portal.
- Barcode/RFID counting.
- Multi-branch consolidation.
- Accounting integration.

Keep the schema multi-store-ready (§6.5) without building it.

## Outputs (Handoff to Phase 10)

- A hardened, measured, backed-up system ready for launch and for optional agentic assistance.

## Delivery Priority

**Should have / hardening.**
