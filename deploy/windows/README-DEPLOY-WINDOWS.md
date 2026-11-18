# O2 Support Hub — Deploying on your own Windows Server

This package is the complete, ready-to-run application: the server (Node.js), the built web app, the Windows
components it needs (no internet required during install), setup scripts and the database scripts.

```
O2-Support-Hub\
  app\backend\            server: Node.js / Express API + database migrations (node_modules for Windows x64 included)
  app\frontend\dist\      built web app (served by the same process)
  config\o2.env.template  settings template (the installer creates config\o2.env)
  database\               create-database.sql, schema.sql, demo data, database structure reference
  iis\web.config          reverse-proxy config for IIS (HTTPS)
  scripts\                install.ps1, install-service.ps1, uninstall-service.ps1, backup-database.ps1
  start-server.cmd        starts the app (used by the service as well)
  data\uploads\           uploaded files (created on install)    logs\  server.log    backups\  database backups
```

Everything is free and open source (Node.js, PostgreSQL, React, Express, Prisma … — see the source package README).
IIS, URL Rewrite and ARR are free Windows components from Microsoft.

---

## 1. Requirements

| | Minimum | Recommended |
|---|---|---|
| Windows | Windows Server 2019 x64 | Windows Server 2022 / 2025 |
| CPU / RAM | 2 cores / 4 GB | 4 cores / 8 GB |
| Disk | 5 GB free | SSD, plus space for uploads and backups |
| Node.js | 22 LTS (x64) | latest 22 LTS |
| PostgreSQL | 14 | 16 or 17 |
| HTTPS | — | IIS + certificate (section 6) |

The database can be on the same server or on a separate PostgreSQL server.

## 2. Install PostgreSQL (skip if you already have one)

1. Download the Windows installer for PostgreSQL 16 or 17 from <https://www.postgresql.org/download/windows/> (EDB installer).
2. Run it with the defaults. Choose and **write down the password for the `postgres` superuser**. Keep port 5432.
3. Leave "Stack Builder" unticked at the end.

## 3. Install Node.js

1. Download **Node.js 22 LTS — Windows Installer (.msi), x64** from <https://nodejs.org>.
2. Install with the defaults (it installs for all users and adds `node` to the system PATH — needed for the service).
3. Open a **new** PowerShell window and check: `node -v` → `v22.x.x`.

## 4. Copy the application

1. Extract this zip to a short path, e.g. **`C:\O2-Support-Hub`** (avoid paths with spaces or OneDrive folders).
2. If Windows blocked the downloaded zip: right-click the zip → Properties → tick **Unblock** before extracting
   (otherwise PowerShell refuses the scripts).

## 5. Run the installer

Open **PowerShell as Administrator**:

```powershell
cd C:\O2-Support-Hub
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

It asks a few questions:

| Question | What to answer |
|---|---|
| PostgreSQL host / port | `localhost` / `5432` (or your database server) |
| Database name / login | defaults `o2_support_hub` / `o2app` |
| Password for o2app | a new strong password (it creates the login for you) |
| Create the database now? | **y**, then the `postgres` superuser password from step 2 |
| HTTPS (IIS)? | **y** for production (section 6). **n** for a plain-HTTP internal test |
| Internal port | `4000` |
| Address users type | e.g. `https://o2.yourcompany.com` (exactly what users will type, no trailing slash) |
| Organisation / admin | **1** = create your organisation and first administrator (real use) · **2** = demo data |

It then writes `config\o2.env` (readable by Administrators/SYSTEM only), creates all database tables and your admin account.

**Quick test:** run `.\start-server.cmd` and open `http://localhost:4000` on the server. Sign in with the admin
e-mail and password you entered. Press Ctrl+C to stop.

> If you answered **n** to HTTPS, users open `http://SERVERNAME:4000`; run step 7 with `-OpenFirewall`.
> Plain HTTP sends session cookies unencrypted — use it only on a trusted internal network.

## 6. HTTPS with IIS (recommended for production)

IIS receives HTTPS on port 443 and forwards to the app on `127.0.0.1:4000`.

1. **Install IIS** (Server Manager → Add Roles and Features → Web Server (IIS)), or in PowerShell:
   `Install-WindowsFeature Web-Server -IncludeManagementTools`
2. **Install two free Microsoft modules**:
   - URL Rewrite 2.1 — <https://www.iis.net/downloads/microsoft/url-rewrite>
   - Application Request Routing 3.0 — <https://www.iis.net/downloads/microsoft/application-request-routing>
3. **Turn on the proxy and disable response buffering** (needed for live updates). In an Administrator command prompt:
   ```bat
   %windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /responseBufferLimit:"0" /commit:apphost
   ```
4. **Certificate**: import your company certificate (IIS Manager → Server Certificates), or get a free Let's Encrypt
   certificate with **win-acme** (<https://www.win-acme.com>) if the server is reachable from the internet.
5. **Create the site**: IIS Manager → Sites → Add Website
   - Site name `O2 Support Hub`, Physical path **`C:\O2-Support-Hub\iis`** (contains the `web.config`)
   - Binding: **https**, port 443, host name `o2.yourcompany.com`, your certificate. Add an **http** port 80 binding too (it redirects to HTTPS).
   - Stop or remove the "Default Web Site" if it uses the same bindings.
6. Make sure `config\o2.env` has `APP_ORIGIN=https://o2.yourcompany.com`, `CORS_ORIGINS` the same, `COOKIE_SECURE=true`,
   `TRUST_PROXY=1`. Restart the app after any change (section 7).
7. DNS: point `o2.yourcompany.com` to the server. Firewall: allow 80 and 443; **do not** open port 4000.

If you changed `PORT`, change `127.0.0.1:4000` in `iis\web.config` too.

## 7. Run it as a background service

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
# add -OpenFirewall only for plain-HTTP setups without IIS
```

This registers a Windows scheduled task **"O2 Support Hub"** that starts at boot as SYSTEM (no one needs to be logged in),
applies any pending database upgrades, and restarts the app automatically if it stops. Output: `logs\server.log`.

| Action | Command |
|---|---|
| Stop | `Stop-ScheduledTask -TaskName 'O2 Support Hub'` (then `.\scripts\uninstall-service.ps1` stops leftover node processes) |
| Start | `Start-ScheduledTask -TaskName 'O2 Support Hub'` |
| Restart after changing settings | `.\scripts\install-service.ps1` (re-registers and restarts) |
| Remove | `.\scripts\uninstall-service.ps1` |
| Health check | open `http://127.0.0.1:4000/ready` → `{"status":"ready"}` |

## 8. Backups and restore

```powershell
.\scripts\backup-database.ps1             # backup now → backups\o2-db-YYYYMMDD-HHmm.backup (+ uploaded files zip)
.\scripts\backup-database.ps1 -Schedule   # daily at 01:30, keeps the latest 14
```

Copy the `backups` folder to another machine or network share regularly.

**Restore** (stop the service first):

```bat
"C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U o2app -h localhost -d o2_support_hub --clean --if-exists --no-owner backups\o2-db-20261118-0130.backup
```

Unzip the matching `o2-files-*.zip` into `data\uploads`, then start the service.

## 9. Updating to a newer version

1. Back up (section 8) and stop the service: `.\scripts\uninstall-service.ps1`.
2. Replace **only** the `app` folder with the one from the new package. Keep `config`, `data`, `logs`, `backups`.
3. Start again: `.\scripts\install-service.ps1`. Database upgrades run automatically on start (see `logs\server.log`).

## 10. E-mail (optional)

Without e-mail settings everything works and notifications stay in the app; admins hand out temporary passwords.
To send invitations, password resets and notification e-mails, set in `config\o2.env`, e.g. for Microsoft 365:

```
SMTP_URL=smtp://support%40yourcompany.com:YOUR-PASSWORD@smtp.office365.com:587
MAIL_FROM=O2 Support Hub <support@yourcompany.com>
```

(`@` in the user name becomes `%40`.) Restart the service.

## 11. Users, roles and first steps

- Sign in with the administrator → **Settings → Users & roles** → *Add user* (designation, department, role). The user gets a
  temporary password and must change it at first sign-in.
- Roles: **Admin** (everything incl. settings), **Manager** (projects, planning, reports, resource planner),
  **Employee** (own tasks, time, tickets), **Customer** (client portal: their projects, tickets, help centre).
- Add client companies under **Settings → Clients**, then invite their users with role Customer.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| "running scripts is disabled" | Use `powershell -ExecutionPolicy Bypass -File …` as shown, and unblock the zip (step 4) |
| `logs\server.log` shows "Invalid configuration" | A value in `config\o2.env` is wrong (the line names the setting) |
| "Refusing to start: COOKIE_SECURE…" | Use HTTPS (section 6) or set `COOKIE_SECURE=false` and `ALLOW_INSECURE_HTTP=true` for an internal HTTP test |
| "Requests from … are not allowed" | `APP_ORIGIN` must equal the address in the browser bar exactly (scheme, host, port). If users also use another name or the IP, add it to `CORS_ORIGINS` (comma-separated) |
| Cannot connect to the database | PostgreSQL service running? Password in `DATABASE_URL` URL-encoded (`@`→`%40`, `#`→`%23`)? |
| Live updates slow / only on refresh behind IIS | Re-run the `appcmd … responseBufferLimit:"0"` command (section 6.3) |
| Port 4000 already in use | Change `PORT` in `config\o2.env` and in `iis\web.config` |
| Service does not start after reboot | Task Scheduler → "O2 Support Hub" → History; check Node.js was installed for all users |

## 13. Security checklist

- HTTPS only (`COOKIE_SECURE=true`), port 4000 not reachable from outside.
- Strong, unique passwords for `postgres`, `o2app` and the administrator; don't use the demo database in production.
- PostgreSQL listening only on localhost (default) unless the app is on another server.
- Daily backups copied off the server; Windows Updates applied.
- `config\o2.env` contains secrets — it is locked to Administrators/SYSTEM by the installer; don't share it.
