# Building the Windows deployment package from source

On any machine with Node.js 22 (Linux, macOS or Windows):

```bash
cd frontend && npm ci && npm run build && cd ..
PKG=dist/O2-Support-Hub && rm -rf $PKG && mkdir -p $PKG/app/backend $PKG/app/frontend $PKG/database
cp -r deploy/windows/* $PKG/
cp -r backend/src backend/scripts backend/prisma backend/package.json backend/package-lock.json backend/prisma.config.js $PKG/app/backend/
rm $PKG/app/backend/scripts/run-local.js
cp -r frontend/dist $PKG/app/frontend/dist
# Windows x64 runtime dependencies (works from Linux/macOS too)
(cd $PKG/app/backend && npm ci --omit=dev --os=win32 --cpu=x64 && rm -rf node_modules/.bin node_modules/embedded-postgres node_modules/@embedded-postgres)
```

Add the database folder (schema.sql etc.) from a migrated database with `pg_dump -s --no-owner --no-privileges`.
Then zip `dist/O2-Support-Hub`.
