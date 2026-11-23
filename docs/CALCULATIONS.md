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

## Original plan vs working plan (`src/domain/variance.js`)

A project's plan is a **draft** until the project manager approves it (Plan tab → *Approve & lock original plan*). Approval
requires at least one task and dates on every task/milestone. It copies every work item's dates, estimate, owner, phase and
title into a baseline of kind `ORIGINAL`. A unique index allows one per project, and the trigger `o2_protect_original_baseline`
rejects any UPDATE, and any DELETE while the project still exists. Tasks remain editable: that is the working plan.

Per task/subtask/milestone (working days on the project calendar; + = later than the original):

| Status | Rule |
|---|---|
| DONE_ON_TIME / DONE_LATE | finished; actual finish vs original finish |
| OVERDUE | not finished and the original finish date has passed |
| DELAYED / AHEAD / ON_TRACK | not finished; forecast finish later / earlier / equal to the original finish |
| NOT_SCHEDULED | no dates |
| ADDED / REMOVED | not in the original / in the original but deleted or cancelled |

Forecast finish of unfinished work = its planned finish, but not earlier than today if already overdue.
Project and phase: original finish = latest original finish; forecast finish = latest forecast finish; planned % (PV) =
original effort (estimate hours, or equal weights) scheduled to be done by the start of today, pro rata by working days
(today is still in progress, so a project that starts today expects 0%); done % (EV) =
the same items by % complete. SPI = done % ÷ planned %. Added work counts in neither, so new scope cannot hide delays.
Status: DELAYED if the end slips > 5 working days or SPI < 0.8; AT_RISK if the end slips, any task is overdue/delayed or
SPI < 0.95; AHEAD if the end moves earlier (SPI ≥ 1) or SPI > 1.1; COMPLETED when all work is done; otherwise ON_TRACK.

## Changing dates (`src/domain/dates.js`, `POST /projects/:id/work-items/:itemId/dates`)

Every date edit (task table, task panel, Gantt drag) goes through one endpoint:

- Only real dates between 2000 and 2100 are accepted (half-typed values such as `0002-12-04` or `2026-02-30` are refused).
- Moving the **start** keeps the task's length in working days on the project calendar; the due date moves with it.
- Changing the **due date** keeps the start; a due date before the start is refused with a message.
- Milestones have one date (start = due).
- After saving, the plan is recalculated automatically (see below): every task that waits for this one moves
  with it, keeping its working-day length. A stale version is refused (409).
- A start typed by the manager becomes the task's fixed start ("not before"); if the task waits for a task that
  finishes later, it is held after that task and the answer says which one (`heldBy`). `autoStart: true` frees it.
- A dependent may start on the working day after its predecessor finishes (+ lag); a weekend/holiday finish
  counts as finished that day (Sat finish → Mon start).
- Lateness = working days after the planned date up to the actual/expected date (Fri→Mon = 1, Sat→Mon = 1).
- Phase dates shown in the app are the span of their tasks; `workFinish` is where the scheduled work ends.

In the browser, a date is saved once — on Enter, Tab, leaving the field or picking from the calendar pop-up — never
while digits are being typed.

## Automatic scheduling (`src/domain/autoSchedule.js`, `src/services/autoSchedule.js`)

The working plan is recalculated after every change that can move dates (task added, changed, removed; link added or
removed; project start, calendar or status changed; plan builder edits) and once an hour for active projects.

- **Parallel work:** a task that waits for nothing starts at the project start (or at its fixed start). Several such
  tasks therefore run at the same time.
- **Dependencies (finish-to-start):** a task that waits for others starts on the working day after the **last** of them
  finishes (+ lag in working days). Its finish keeps its length in working days. A task whose start does not move keeps
  its due date exactly as typed.
- **Fixed start ("start no earlier than"):** set when the manager types a start date. Links can only push such a task
  later, never earlier. Without a fixed start, a task also moves **earlier** when the work it waits for gets shorter.
- **Milestones** fall on the day their last predecessor finishes (+ lag), or on their fixed date if that is later.
- **Started and finished work never moves.** Finished work hands on its actual finish date.
- **Delays:** in an active project, unfinished work whose due date has passed is expected to finish today at the
  earliest, so everything that waits for it moves out day by day until it is done. The late task itself keeps its
  dates, so it still shows as overdue.
- **Work packages** span their children; a link to or from a work package applies to all of its children.
- **A task with sub-tasks is a box.** It keeps its own length and is placed like any task (after what it waits for);
  its sub-tasks are scheduled inside it: none starts before the task, and they run one after another or in parallel.
  Whatever waits for the task also waits for its sub-tasks. If sub-tasks would end after the task, the plan editor
  refuses the change (the API answers 400 with the date they would need); elsewhere the task is stretched to cover
  them and the overrun is reported (`rescheduled.overflow`).
- Cancelled and undated items are ignored. A circular set of links is refused.
- **Project end:** until the plan is approved, the project's end date is the end of its last task. After approval
  the original end stays fixed and the expected end (forecast) moves.
- **Upgrade:** existing plans keep their dates. Tasks that already started right after the task they wait for are
  switched to automatic; the others keep their start as a fixed start.

### Plan builder (`/projects/:id/plan-items`)

Each row is *task · who · working days · starts after*. Effort defaults to days × 8 h and follows the length while it
is still the default. "Starts after" offers: project start, after the previous task, at the same time as the previous
task (same predecessors = parallel), or any set of tasks. Removing a task reconnects what waited for it to what it
waited for, so a chain is never broken.

**Sub-tasks.** Any task can be split into sub-tasks (`type: SUBTASK`, `parentId` = the task). The task keeps its
own number of working days, and its sub-tasks get their own start and end dates **inside** those days: the first
starts with the task, the next ones either after another sub-task of the same task or at the same time (parallel).
A sub-task can only wait for sub-tasks of the same task, and a task never waits for its own sub-tasks. A change that
would push a sub-task past the task's end is refused with the date it would need — make the task longer, or the
sub-tasks shorter or parallel. Sub-tasks take the task's owner unless another person is chosen.

**Milestones** are kept apart from the task plan: a name and a date (a fixed date), listed under *Milestones* on the
Plan tab, on the Timeline and the Calendar. Tasks do not wait for milestones, and milestones are not shown in the
task List or Board.

**Project start** cannot be in the future (today or earlier, in the project's time zone).

**Until the plan is approved** the project is in set-up: the Tasks views (list, timeline, board, calendar) and the
status report are closed, work cannot be started or completed, time cannot be logged and the project cannot be
started. Everything opens when the project director approves the plan.
