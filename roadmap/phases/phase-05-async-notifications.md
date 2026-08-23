---
title: Phase 5 - Async Spine and Notifications
date: 2026-08-17
tags:
  - herms
  - roadmap
  - notifications
  - sqs
  - outbox
status: draft
---

# Phase 5: Async Spine and Notifications

## Goal

Make communication reliable and asynchronous: drain the outbox, deliver via SQS, and integrate the notification provider.

## Why the Queue Arrives Now

Phases 2–4 wrote to an outbox instead of calling providers directly, so nothing has to be rewritten — only drained.

## Prerequisites (Inputs from Phases 2–4)

- `outbox` rows written by quotation, note, and approval flows.
- Confirmed notification provider (D-01) and the WhatsApp BSP application from Phase 0.

## Work Items (in order)

1. Outbox publisher: drain `pending` rows → SQS (never `PutMessage` from the request path).
2. SQS queue + dead-letter queue + alarm on DLQ depth > 0.
3. `apps/notifier`: Notification Lambda consuming SQS, own deploy.
4. Provider integration: WhatsApp primary, SMS fallback, email back-office (SRS §4.3).
5. Idempotency key per notification (dedupe at-least-once deliveries).
6. Wire up events: quotation to customer (FR-2.2), note link to field staff (FR-11.1), pending-approval alert and approval alert (FR-11.4), link resend (FR-11.5).

## Schema Changes

None — `outbox` was created in Phase 2. This phase only drains it.

## Notifications to Wire Up

- Quotation to customer (FR-2.2).
- Note link to field staff (FR-11.1).
- Admin alert on pending approval; sales/finance alert on approval (FR-11.4).
- Link resend/regenerate with attribution (FR-11.5).

## Invariants Touched

- **I-12** — outbox before provider; idempotent consumers.

## Requirements Traceability

- FR-2.2: quotation delivery.
- FR-11.4, FR-11.5: approval alerts and link resend.
- SRS §4.3: notification strategy and fallback.

## Tests

- Killing the WhatsApp credential causes messages to fall back to SMS.
- Messages reach the DLQ only after both primary and fallback fail.
- Re-delivery never produces a duplicate quotation or link.

## Definition of Done

- Provider failures retry without duplicating business records.
- DLQ depth is alarmed and observable.
- Every notification is traceable to its source `outbox` event.

## Outputs (Handoff to Phases 6–8)

- Production notifications for all events; DLQ observability.

## Delivery Priority

**Production gate.**
