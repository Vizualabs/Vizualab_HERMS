---
title: HERMS Frontend Architecture
date: 2026-08-17
tags:
  - herms
  - architecture
  - frontend
status: draft
---

# HERMS Frontend Architecture

The frontend is **TanStack Start**, served as static assets from the **Hostinger VPS behind Nginx**. Nginx also proxies `/api/*` same-origin to the Lambda Function URL.

## Two User Surfaces

### 1. Back-office (desktop-first)

Used by Sales, Store Admin, Finance, and Management:

- Customer and equipment master data.
- Quotation creation and status tracking.
- Order view and Delivery/Retention Note management.
- Store Admin pending-approval queue with physical-count entry.
- Discrepancy registry and damage-claim review.
- Payments, expenses, and the management dashboard.

### 2. Mobile link forms (field staff)

Field staff submit Delivery Notes and Retention Notes through a **scoped, expiring link** with **no full login** (FR-12.2, I-9):

- Mobile-responsive, pre-filled with the order's lines.
- Form target: under two minutes for a typical order (§6.4).
- Token exposes exactly one note and expires at read time.
- Every use is logged; tokens never appear in a URL query string.

## RBAC in the UI

- Role-based visibility is a UX convenience only — enforcement is server-side.
- A Sales user sees customers but not the audit log; a Field Staff user reaches neither (Phase 1 exit criteria).
- Sensitive actions (approval, claim confirmation, reversal) are gated by the backend, never by hiding a button.

## Notifications Rendering

- Quotations provide a downloadable PDF and a secure customer link. Staff copy the link or use the WhatsApp icon to open a prepared message manually.
- Delivery and retention screens expose Open, Copy, and WhatsApp actions for their secure links.
- The WhatsApp icon opens WhatsApp Web; HERMS never chooses a recipient or sends a message automatically.

## Observability

- A request ID is propagated from web to API and surfaced in the UI for support correlation.
- Client logs are structured JSON and shipped alongside server logs.

## Deployment

- Two CI/CD pipelines: one rsync/deploys the static bundle to the VPS, the other deploys the Lambda.
- Nginx `proxy_read_timeout` must exceed the Lambda timeout to avoid 504s that look like application bugs.
- Health check (`/api/health`) is green from a real browser before any release is considered deployed (Phase 0 exit criteria).
