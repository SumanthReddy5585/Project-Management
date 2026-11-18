# REST API

Base path `/api`. JSON in and out. Authentication uses an HttpOnly session cookie. Every non-GET request from a signed-in session must send `X-CSRF-Token` (the value comes from `/auth/me` or the login response).

**Conventions**

- Lists: `?page=1&pageSize=25&q=&sort=&dir=asc|desc`, returning `{ data: [...], meta: { page, pageSize, total, pages } }`.
- Errors: `{ error: { code, message, details? }, requestId }`. Codes: `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (also for records outside your scope), `CONFLICT` 409 (stale `version` or state), `DUPLICATE` 409, `FILE_TOO_LARGE` 413, `VALIDATION_FAILED` 422 (`details[]` per field), `RATE_LIMITED` 429.
- Concurrency: updates to versioned records require `version`. A mismatch returns 409.
- Dates: business dates are `YYYY-MM-DD`; timestamps are ISO-8601 UTC.

## Auth `/auth`
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email,password}`, limited to 10 failed attempts per 15 min per IP and email |
| POST | `/auth/logout` | Deletes the server-side session |
| GET | `/auth/me` | User, org, role, customer company, CSRF token, permission matrix |
| GET | `/auth/invitations/:token` | Invitation preview |
| POST | `/auth/invitations/accept` | `{token,name,password}`, single use |
| POST | `/auth/password/forgot` | Always 200; notifies org admins (email not configured) |
| POST | `/auth/password/reset` | `{token,password}`, single use, revokes all sessions |

## Organization `/org` (admin unless noted)
`GET /org` · `PATCH /org` · `GET /org/members` (internal users) · `PATCH /org/members/:userId` · `POST /org/members/:userId/reset-link` · `GET|POST /org/invitations` · `DELETE /org/invitations/:id` · `GET|POST /org/teams`, `PATCH /org/teams/:id` · `GET|POST /org/customers`, `PATCH /org/customers/:id` · `GET|POST /org/calendars`, `PATCH /org/calendars/:id` · `GET|POST /org/templates`, `PATCH /org/templates/:id` · `GET|PUT /org/ticket-settings` · `GET /org/audit`

## Projects `/projects`
| Method | Path |
|---|---|
| GET, POST | `/projects` (POST creates from a template) |
| GET, PATCH | `/projects/:id` |
| POST | `/projects/:id/status` (lifecycle transition) |
| PUT, DELETE | `/projects/:id/members/:userId` |
| POST | `/projects/:id/phases` · PATCH/DELETE `/projects/:id/phases/:phaseId` · POST `/projects/:id/phases/reorder` |
| GET, POST | `/projects/:id/baselines` · GET `/projects/:id/baselines/:baselineId/compare` |
| GET, POST | `/projects/:id/work-items` (filters: phaseId, parentId, assigneeId=me/none/uuid, status, type, overdue, label, q, all=true) |
| GET, PATCH, DELETE | `/projects/:id/work-items/:itemId` |
| POST | `/projects/:id/work-items/bulk` |
| POST, PATCH, DELETE | `/projects/:id/work-items/:itemId/checklist[/:cid]` · PUT `…/collaborators` |
| GET, POST, DELETE | `/projects/:id/dependencies[/:depId]` |
| POST | `/projects/:id/schedule/preview` · `/projects/:id/schedule/apply` |
| GET | `/projects/:id/schedule/analysis` (conflicts, overdue, critical path) |
| GET | `/projects/:id/progress` · `/projects/:id/activity` · `/projects/:id/export/work-items.csv` |
| GET, POST, PATCH | `/projects/:id/registers/{risks,issues,decisions,change-requests}[/:rid]` |
| GET, POST | `/projects/:id/deliverables` · PATCH `/:did` · POST `/:did/versions`, `/:did/submit`, `/:did/review` |
| GET, POST | `/projects/:id/updates` · `/projects/:id/discussions` |

## Collaboration
`GET|POST /comments?targetType=workItem|discussion&targetId=` · `PATCH|DELETE /comments/:id` · `GET|POST /files` (multipart `files[]`, `targetType`, `targetId`, `visibility`) · `GET /files/:id/download` · `DELETE /files/:id` · `GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `GET /search?q=`

## Time `/time`
`GET /time/week?weekStart=` · `POST /time/entries` · `PATCH|DELETE /time/entries/:id` · `POST /time/timesheets/:id/submit` · `GET /time/approvals?status=` · `POST /time/timesheets/:id/approve|reject`

## Tickets `/tickets`
`GET /tickets` (status=open|…, priority, type, assigneeId, customerCompanyId, projectId, sla=BREACHED) · `POST /tickets` · `GET|PATCH /tickets/:id` · `POST /tickets/:id/status` · `POST /tickets/:id/messages` (`visibility` PUBLIC|INTERNAL) · `POST /tickets/:id/links` · `DELETE /tickets/:id/links/:workItemId` · `POST /tickets/:id/create-task` · `GET /tickets/export.csv`

## Reports
`GET /dashboard` (role-specific payload: `kind` = management | employee | customer) · `GET /workload?from=&to=` · `GET /reports/portfolio.csv` · `GET /reports/time.csv?from=&to=&projectId=`

## Operations
`GET /health` (liveness) · `GET /ready` (database reachable)

## Support desk (added for O2 Support Hub)

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/tickets/views` | all | Counts for queue views (`mine`, `unassigned`, `open`, `overdue`, `waiting`, `new`, `resolved`, `all`; clients: `open`, `waiting`, `resolved`, `requested`, `all`) |
| `GET /api/tickets?view=…&tag=…` | all | List a view; `tag` is staff-only |
| `GET /api/tickets/stats` | staff | Dashboard metrics: open/unassigned/breached/at-risk, 14-day created vs resolved, avg first reply & resolution, SLA compliance (30d), CSAT (90d), workload by agent and client |
| `POST /api/tickets/bulk` | staff | `{ids, assigneeId?, priority?, status?, addTag?}`; illegal status moves are skipped and reported |
| `PATCH /api/tickets/:id` | staff | Now also accepts `tags` |
| `POST /api/tickets/:id/csat` | requester | `{rating 1–5, comment?}` once the ticket is resolved or closed |
| `GET/POST/PATCH/DELETE /api/canned-responses` | staff | Saved replies; placeholders `{{requester}} {{number}} {{agent}} {{subject}}` are filled in the browser |
| `GET /api/kb/articles?q=&category=` | all | Clients see published `PUBLIC` articles only; search matches every word in any order |
| `GET /api/kb/articles/:id` · `POST …/feedback` | all | Read (counts a view) and vote helpful / not helpful |
| `POST/PATCH /api/kb/articles` · `DELETE` | staff · managers | Write and publish; delete is managers only |
| `GET /api/events` | all | Server-Sent Events: `{type, ticketId?, projectId?, self}` — ids only, filtered per user |
