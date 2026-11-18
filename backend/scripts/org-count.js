// Prints the number of organisations in the database (used by the Windows installer).
import '../src/lib/dbUrl.js';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
console.log((await c.query('SELECT count(*)::int AS n FROM "Organization"')).rows[0].n);
await c.end();
