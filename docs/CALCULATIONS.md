# Calculations

Every metric is computed from persisted data at request time. Nothing is cached, so dashboards and records cannot drift apart. Implementations live in `backend/src/domain/` and are covered by unit tests.

## Progress rollup (`domain/progress.js`)

- **Leaves** are work items with no non-cancelled children. MILESTONEs never carry effort weight.
- **Leaf percent:** `100` if status is DONE, otherwise the stored `percentComplete`.
- **Weight:** `estimateHours` when > 0. A leaf without an estimate gets the **mean estimate of the estimated leaves in the same scope**. If no leaf in scope has an estimate, all leaves weigh 1 (count-based) and the UI labels progress "by count".
- **Rollup:** `Σ(weight × percent) / Σ(weight)` over the leaves under a module, task, phase or the whole project.
- **Cancelled work** (and anything under a cancelled parent) is excluded from both numerator and denominator.
- **Milestones** are reported separately as `done / total`.
- Customers see the same project percentage (an aggregate), never the item-level estimates behind it.

Example (integration test): leaves of 30 h DONE, 10 h at 0% and 4 h at 0% give 30/44 = **68.2%**.

## Status ↔ percent consistency (`domain/workflow.js`)

| Change | Effect |
|---|---|
| status → DONE | percent = 100; actualStart and actualFinish default to today |
| status → TODO | percent = 0 |
| leaving DONE | percent capped at 90; actualFinish cleared |
| percent > 0 on TODO | status → IN_PROGRESS |
| percent = 100 on a non-DONE item | status → IN_REVIEW (DONE stays an explicit decision) |
| DONE with open children | rejected |

Planned dates and assignments are never changed by these rules.

## Working days (`domain/calendar.js`)

The calendar has working weekdays (ISO 1–7, so Sun–Thu weeks are supported) and holidays. Durations count working days **inclusively** between planned start and finish. Template phases are scaled proportionally to the project's working-day window and laid out back to back. The last phase ends on the planned finish.

## Dependencies and scheduling (`domain/dependencies.js`)

- **Cycles** are rejected when the link is created (DFS) under a per-project advisory lock.
- **FS conflict:** a successor whose planned start is earlier than the next working day after the predecessor's finish (+ lag working days).
- **Impact preview:** moving an item pushes conflicting FS successors **later only**, keeping their working-day durations, transitively. DONE and CANCELLED items are not moved. The preview saves nothing.
- **Apply** recomputes the preview inside a transaction and refuses (409) if it differs from the moves you confirmed. Without "include downstream", only the item itself moves and its successors show conflicts.
- **Critical path (CPM):** forward/backward pass over FS links using working-day durations from planned dates. Zero-slack linked items are critical. Undated items are excluded and counted.

## Baselines and schedule variance

A baseline snapshots every item's planned start, finish and estimate. Item variance is the working-day difference between baseline and current dates (positive = later). **Project schedule variance** on the dashboard is the working days between the latest planned finish now and the latest planned finish in the most recent baseline. Approving a change request never edits a baseline. You re-baseline explicitly and can reference the approved change request, which marks it IMPLEMENTED in the audit trail.

## Capacity and workload (`domain/capacity.js`)

- `capacity = working days in range × weeklyCapacityHours ÷ working days per week` (org default calendar).
- `planned load = Σ over assigned open TASK/SUBTASK items with dates and estimates of estimate × (1 − percent) × (working days of the item inside the range ÷ the item's total working days)`.
- `utilization = planned ÷ capacity`: OK below 85%, FULL from 85% to 100%, OVER above 100%.
- Logged time is shown next to these figures but never mixed into planned load. Unestimated tasks are counted and flagged, not guessed.

## Time and timesheets

Entries roll into an ISO-week timesheet (DRAFT → SUBMITTED → APPROVED/REJECTED). SUBMITTED and APPROVED weeks are locked against edits. Approval uses a guarded update (`status = SUBMITTED AND version = ?`), so double clicks or two reviewers cannot both succeed. Daily totals are capped at 24 h, entries use quarter hours, and future dates are refused.

## Budget consumption

`consumed = billable hours × project hourly rate`, shown only to admins and project managers and only when a budget is set. Without a rate it shows "—" rather than a guess.

## SLA (`domain/businessHours.js`, `domain/sla.js`)

- Targets per priority come from `SlaPolicy`, in **business minutes** on the policy calendar (working days, daily hours, holidays, timezone).
- `responseDueAt` and `resolutionDueAt` are calculated from the creation time.
- **Response** stops at the first *public* reply from an internal user. **Resolution** stops at RESOLVED or CLOSED.
- **Pause:** while WAITING_ON_CUSTOMER, both clocks pause. On leaving that status, due dates move out by the business minutes spent paused. A customer reply on a waiting ticket reopens it automatically (documented sync).
- **Reopen:** RESOLVED/CLOSED → OPEN clears the resolution timestamps and extends the resolution due date by the business minutes spent resolved.
- **States:** MET, BREACHED, PAUSED, AT_RISK (remaining ≤ 25% of target) or ON_TRACK.
- **Priority change** recalculates both targets from the creation time.
- The background job sends one notification per ticket, clock and state (deduplicated).

The SLA performance chart covers tickets created in the last 30 days plus all open tickets.
