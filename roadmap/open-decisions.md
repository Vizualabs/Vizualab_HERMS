---
title: HERMS Open Decisions and Implementation Risks
date: 2026-08-17
tags:
  - herms
  - roadmap
  - decisions
  - risks
status: needs-review
---

# Open Decisions and Implementation Risks

These items should be resolved before the affected phase is marked complete. They are based on the SRS, the `IMPORTANT .docx` client notes, and the supplied architecture diagram. Deployment-specific risks live in [Architecture Risks](architecture-risks.md).

## Client Decisions

| ID | Decision | Affected phase | Recommended direction |
|---|---|---|---|
| D-01 | Confirm the primary notification provider and fallback behavior. | 2, 3, 5 | Confirm WhatsApp Business API first; define SMS fallback and email scope separately. Start the BSP application now — it is long-lead. |
| D-02 | Confirm the exact printed/PDF Delivery Note and Retention Note layouts. | 0, 3, 9 | Reproduce the existing paper fields before finalizing forms. |
| D-03 | Confirm whether price escalation is automatic or awaits Business Owner confirmation. | 7 | Keep the escalation calculation deterministic; make confirmation a separate approval state only if the client requires it. |
| D-04 | Confirm whether damage claims require a separate approval before affecting balances. | 7 | Require Finance confirmation as specified by FR-9.6. |
| D-05 | Confirm the launch role model and store/branch scope. | 1, 3 | Keep the six SRS roles and include store scope in users, stock, notes, and approvals. |

## Requirement Clarifications

| ID | Clarification | Risk if unresolved |
|---|---|---|
| R-01 | FR-9.1 says current unit price, while FR-9.5 and BR-6 require the price on the damage date. This is the most commonly mis-implemented rule. | Incorrect claim values and financial disputes. Use a point-in-time `price_history` lookup. |
| R-02 | FR-11.5 mentions SMS fallback, but the requirement itself only covers resend/regeneration. | Fallback behavior may be implemented without a clear requirement or acceptance test. |
| R-03 | FR-4.7 references FR-7.7, but FR-7.7 does not exist. | Reopening permissions and audit behavior remain undefined. |
| R-04 | Define whether original delivered quantity means approved handed-over quantity or another quantity. | Return reconciliation and stock totals may disagree. |
| R-05 | Define stock semantics when issued and handed-over quantities differ. | Delivery stock-out may be calculated incorrectly. |
| R-06 | Define the responsible party for delivery mismatches. | Claims and discrepancy ownership may be inconsistent. |

## Non-functional Clarifications

| ID | Clarification | Risk if unresolved |
|---|---|---|
| N-01 | Cold-start + Neon autosuspend may exceed the 3-second dashboard NFR (§6.1). | Measure in Phase 0; choose the driver and warm strategy then. |
| N-02 | Reconcile the 99.5% uptime target (§6.3) with scale-to-zero Lambda and Neon autosuspend. | Define a realistic warm/scale policy before launch. |

## Resolution Rule

No implementation should silently choose a behavior that affects stock, money, price history, authorization, or customer responsibility. Record the decision, update the SRS, and add or update acceptance criteria before closing the relevant roadmap phase.

Where a task depends on an open item, implement it behind a config flag and flag it in the task report — do not invent an answer. Equipment is counted in whole units with no batch/lot tracking unless the client states otherwise (SRS §2.6).
