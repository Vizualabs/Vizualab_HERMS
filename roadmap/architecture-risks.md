---
title: HERMS Architecture Risks
date: 2026-08-17
tags:
  - herms
  - roadmap
  - architecture
  - risks
status: needs-review
---

# Architecture Risks Worth Resolving Early

These decisions interact with the deployment architecture and must be resolved in Phase 0 or as soon as the relevant seam is built.

## 1. Cold Start and Neon Autosuspend vs the 3-Second NFR

The diagram already flags "sleeps when idle." A cold Lambda plus a waking Neon compute can exceed the §6.1 budget on the first request.

**Control:** Use Neon's HTTP/serverless driver (no TCP pool to warm), and either raise Neon's autosuspend threshold or keep the function warm during business hours. Measure this in Phase 0, not Phase 8.

## 2. Connection Exhaustion

Never open a classic pooled `pg` connection per Lambda invocation.

**Control:** Decide the driver in Phase 0 and never revisit it. Use a serverless-safe driver that does not depend on a persistent TCP pool.

## 3. Paying for Two Runtimes

The VPS is already serving Nginx; the API could run beside it. Keeping Hono on Lambda is defensible for scale-to-zero and independent deploys, but note the trade: one extra cold-start hop on every request for an app whose whole user base is one owner, a store admin, and a few staff (§1.3).

**Control:** If the cold-start numbers from risk 1 come back bad, moving Hono onto the VPS is the cheapest fix available. Keep the decision reversible until the Phase 0 measurement.

## 4. Same-origin Proxy Hides CORS but not Timeouts

Nginx `proxy_read_timeout` must exceed the Lambda's own timeout, or you will see 504s that look like application bugs.

**Control:** Set and document the timeout relationship during Phase 0.

## 5. Token Leakage

Note links are unauthenticated by design (FR-12.2).

**Control:** Scope them to one note, expire them, log every use, and never place them in a query string that lands in Nginx access logs.

## 6. Public Lambda Function URL

The Lambda Function URL is reachable directly, not only through Nginx.

**Control:** Enforce authentication, token validation, rate limiting, request validation, and monitoring at the Lambda boundary.

## 7. Event Reliability

A successful database mutation followed by a direct SQS publication can lose the notification on post-commit failure.

**Control:** Use the transactional outbox so the event is durable with the business change, then drain it asynchronously.

## 8. Scheduler and Notification Idempotency

- Scheduler retries must not apply price escalation more than once per `(item, effective_date)`.
- Notification retries must not produce duplicate quotations or links.

**Control:** Idempotency keys for both paths; deduplicate notifications by source event.
