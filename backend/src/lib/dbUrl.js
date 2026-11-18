// Hosted Postgres providers (e.g. Neon) hand out URLs with `channel_binding=require`, which node-postgres
// does not accept as a URL option. Drop it; TLS (sslmode) is kept, so the connection stays encrypted.
export function normalizeDbUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch { return url; }
}
if (process.env.DATABASE_URL) process.env.DATABASE_URL = normalizeDbUrl(process.env.DATABASE_URL);
