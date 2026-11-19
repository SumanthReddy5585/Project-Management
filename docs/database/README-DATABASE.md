# O2 Support Hub - Database package

PostgreSQL 14 or newer (16 or 17 recommended). Tested with PostgreSQL 16.

| File | What it is | When to use it |
|---|---|---|
| `create-database.sql` | Creates the login `o2app` and the empty database `o2_support_hub` | First step on a new server (the Windows installer can also do this for you) |
| `schema.sql` | Complete schema: 45 tables, 17 enum types, 101 indexes, 62 foreign keys, the original-plan lock trigger, plus the migration history | Start with an **empty** database for real use |
| `o2_support_hub_demo.sql` | Schema **and** demo data (plain SQL) | Try the app with sample projects, tickets and users |
| `o2_support_hub_demo.backup` | Same demo database in pg_restore format | Restoring with pgAdmin (Restore…) or `pg_restore` |
| `DATABASE-STRUCTURE.html` / `.md` | Every table, column, type, default, key, foreign key, index and enum, with a relationship diagram | Reference for reports, integrations and support |
| `prisma/schema.prisma` | The data model as the application defines it | Developers |
| `prisma/migrations/` | Step-by-step SQL history (6 migrations) | Upgrades are applied automatically by the app on start |

You don't have to load either SQL file by hand: the Windows installer (`scripts\install.ps1`) and every app start run
`app\backend\scripts\db-migrate.js`, which creates/upgrades the tables in an empty database. Use the files below when you prefer
to create the database yourself or want the demo data.

## 1. Create the database (once)

```bat
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -f create-database.sql
```

## 2a. Empty schema for real use

```bat
set PGPASSWORD=your-o2app-password
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U o2app -h localhost -d o2_support_hub -v ON_ERROR_STOP=1 -f schema.sql
```

Then create your organisation and first administrator (the installer offers this too):

```bat
cd C:\O2-Support-Hub\app\backend
set INIT_ADMIN_PASSWORD=Your-Strong-Pass-2026
node --env-file=..\..\config\o2.env prisma\init-org.js --org "O2 Digital Services" --slug o2 --email admin@yourcompany.com --name "Admin Name" --timezone Asia/Kolkata
```

## 2b. Or: demo data

```bat
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U o2app -h localhost -d o2_support_hub -v ON_ERROR_STOP=1 -f o2_support_hub_demo.sql
```

or `pg_restore -U o2app -h localhost -d o2_support_hub --no-owner o2_support_hub_demo.backup`.

Demo sign-ins (all with password **Demo-pass-2026**; change them or don't use the demo database in production):
`admin@demo.local`, `manager@demo.local`, `pm2@demo.local`, `dev1@demo.local`, `dev2@demo.local`, `qa@demo.local`, `design@demo.local`,
`ops@demo.local`, `customer@demo.local` (client: Contoso Retail), `fabrikam@demo.local` (client: Fabrikam Health), `globex.admin@demo.local` (a second, separate organisation).

## 3. Moving your existing cloud data (optional)

The demo files are a clean sample, not a copy of the live cloud site. To bring across what you have entered on
https://meridian-quki.onrender.com: in the Render dashboard open the PostgreSQL database → **Connections** → copy the
**External Database URL**, then on the Windows server:

```bat
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -Fc --no-owner --no-privileges -d "PASTE-EXTERNAL-DATABASE-URL" -f cloud.backup
"C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U o2app -h localhost -d o2_support_hub --no-owner --no-privileges cloud.backup
```

Restore into an empty database. The cloud site stores uploaded files inside the database (`FileBlob`), so they come across too; keep
`STORAGE_DRIVER=db` in `config\o2.env` for those files to keep working, or keep the default `local` for new installs.

## Notes

- Primary keys are UUIDs; all timestamps are stored in UTC (`timestamptz`).
- Passwords are stored as Argon2id hashes; session and reset tokens are stored hashed.
- Back up with `scripts\backup-database.ps1` (uses `pg_dump -Fc`), restore with `pg_restore`.
- The `.backup` file was written by PostgreSQL 16 tools, so restore it with `pg_restore` from PostgreSQL **16 or newer**. The `.sql` files load on PostgreSQL 14+.
- `generate-structure.py` rebuilds `DATABASE-STRUCTURE.md/.html` from any live database: `python generate-structure.py "postgresql://o2app:PASS@localhost:5432/o2_support_hub"` (needs `psql` on PATH and `pip install markdown`).
