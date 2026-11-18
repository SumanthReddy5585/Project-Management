# O2 Support Hub

A multi-tenant **project management + customer support** application for managers, team members and external clients. Project management comes first: a project wizard (details → pick the team with designation, department and current load → review), portfolio table/cards/timeline, phases, Gantt, Kanban, burn-up, effort & budget, duplicate project, save as template, team roles and allocation, activity log and time logging on tasks. Users are added by an admin with designation, department, employee ID and capacity (temporary password or invite link, forced change at first sign-in). Support sits alongside: a live ticket queue with saved views, business-hours SLA timers, canned replies, internal notes, bulk triage, satisfaction ratings, a client portal and a searchable knowledge base. Delivery sits alongside it: planning (phases, modules, tasks, dependencies, timeline, baselines, critical path), execution (Kanban, time tracking, timesheet approval, workload) and service (customer portal, tickets with SLA, deliverable approvals), with strict separation between internal and customer-visible information.

**Stack:** React 19 + Vite 8 + Bootstrap 5 + React Router 7 + Axios + Lucide + Chart.js + Inter (OFL) · Node 22 + Express 5 + Prisma 7 (pg adapter) + PostgreSQL 16 + Server-Sent Events + Nodemailer · Vitest + Playwright. Every dependency is free and open source (MIT/ISC/Apache/OFL).

**Realtime:** every signed-in browser holds one Server-Sent Events connection (`/api/events`). When a ticket, message, task or notification changes, the server pushes only ids, filtered per user and client company; screens re-fetch through the normal permission-checked API. No data travels on the stream itself.

## Run it (easiest)

You only need **Node.js 22 LTS** (free, https://nodejs.org). No database, Docker or other setup.

- **Windows:** double-click `START-WINDOWS.bat` (don't use "Run as administrator").
- **macOS / Linux:** run `./start.sh`.

The first run installs components and creates a bundled local database (about 1–3 minutes). Then the app opens in your browser at **http://localhost:4000**. Later runs start in seconds and keep your data in `backend/.local`. Keep the window open while you use the app; press Ctrl+C to stop. To start over with fresh demo data, stop the app and delete `backend/.local`.

Demo accounts (password **`Demo-pass-2026`**): `admin@demo.local`, `manager@demo.local`, `dev1@demo.local`, `dev2@demo.local`, `qa@demo.local`, `customer@demo.local` (Contoso), `fabrikam@demo.local` (another customer, used for isolation checks), `globex.admin@demo.local` (a separate organization).

## Developer setup

```bash
# backend (needs your own PostgreSQL 16; see docs/OPERATIONS.md)
cd backend && cp .env.example .env && npm ci
npx prisma migrate deploy && npm run seed:demo && npm run dev
# frontend (second terminal)
cd frontend && npm ci && npm run dev     # http://localhost:5173
```

Docker: `POSTGRES_PASSWORD=… docker compose up --build`, then open http://localhost:8080. Full setup, production deployment, backup and restore are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): scope, assumptions, architecture, **permission matrix**, data model diagram, timezones, file storage, phase status
- [docs/CALCULATIONS.md](docs/CALCULATIONS.md): progress rollup, scheduling, critical path, capacity, SLA and metric definitions
- [docs/API.md](docs/API.md): REST endpoints and conventions
- [docs/OPERATIONS.md](docs/OPERATIONS.md): setup, tests, Docker, deployment, backup/restore, security checklist

## Verification performed

| Check | Result |
|---|---|
| Backend unit tests (calendar, SLA/business hours, progress, workflow, dependencies, CPM, capacity) | 27 passed |
| Backend integration tests on a dedicated `_test` DB (49): people admin with designation + forced password change, project team roles, duplicate, save-as-template, burn-up; acceptance workflow steps 1–13, cross-org and guessed-ID access, customer/internal separation across APIs, notifications, search, exports and activity, concurrency, duplicate approval, rate limiting, file security; support desk (views, bulk triage, CSAT rules, canned replies, KB visibility, live-event scoping, SSE stream, database file storage) | 49 passed |
| Browser E2E (Playwright + Chrome): project + quick-add tasks → wizard picks the team → client visibility → client raises ticket → agent assigns, canned reply, internal note → **reply appears live in the client's open browser** → resolve + client rating → other-client URL access | 8 passed |
| Production frontend build | OK |
| Demo seed through the real HTTP API | OK |
| One-click launcher from a fresh unzip (Linux, normal user): install → bundled DB → migration → demo data → app; E2E against it; stop/restart keeps data | OK |
| `START-WINDOWS.bat` on Windows | **Not run here** (no Windows machine in the build environment); same Node launcher as above |
| Docker images | **Not built**: Docker Hub was unreachable from the authoring environment |
| Prisma migration vs schema drift check | **Not run**: the schema-engine binary download was blocked; the CI job and a one-time local check cover it (see OPERATIONS) |

## Feature status

**Complete:** invitations, sessions, password reset (admin-issued links); orgs, teams, customers, calendars with holidays, templates; guided project creation from templates; unified hierarchy (module → task → subtask, milestones) with checklists, labels, collaborators, acceptance criteria and bulk edit; list, board, timeline, calendar and milestone views; FS dependencies with cycle rejection, conflict flags, impact preview and explicit apply; baselines and variance; critical path; effort-weighted progress; time entries, weekly timesheets with approve/reject/lock; workload vs capacity; tickets with business-hours SLA, pause and reopen rules, internal notes, ticket↔task links, task from ticket; deliverable versions with per-version approvals; discussions, status updates, mentions, in-app notifications; risk, issue, decision and change-request registers; role dashboards with Chart.js; CSV exports; audit log; Docker, CI.

**Partial:** SS/FF/SF dependencies are stored and labelled but not scheduled. Timeline rescheduling uses a dialog rather than drag-and-drop. Org switcher for multi-org users is not built (users sign into their first organization).

**Email:** invitations, password resets and notification copies are emailed when `SMTP_URL` is set (any SMTP provider, e.g. Brevo's free plan); without it the app shows copyable links and in-app notifications.

**Not implemented (deliberately not shown as working):** email-to-ticket (inbound mail); configurable workflows per org; automatic (auto-scheduling) mode; MFA/SSO; antivirus scanning of uploads; S3-style storage provider.

## Production readiness

This build runs and passes the checks above locally. That alone does **not** make it production-ready. Before production you still need: a TLS deployment per docs/OPERATIONS.md, managed backups, a shared file volume or object storage for more than one instance, a shared rate-limit store, outbound email, and a security review/penetration test.

## Licensing

Everything is free and open source, with no paid or commercial-license components. Direct dependencies are MIT, ISC, BSD or Apache-2.0: React, React Router, Vite, Bootstrap, Axios, Chart.js (MIT), Lucide (ISC), Express, Prisma (Apache-2.0), zod, helmet, argon2, pino, luxon, multer, dotenv (BSD-2), Vitest, Playwright (Apache-2.0). Infrastructure: PostgreSQL (PostgreSQL License), nginx (BSD-2), Node.js (MIT). The timeline/Gantt is custom code.
