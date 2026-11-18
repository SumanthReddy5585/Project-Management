import { z } from 'zod';
import { unprocessable } from './errors.js';

/** Parse with zod and raise a 422 with field-level issues. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw unprocessable('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export function pageArgs({ page, pageSize }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paged(items, total, { page, pageSize }) {
  return { data: items, meta: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } };
}

/** Pick an allowed sort field or fall back. Prevents arbitrary orderBy injection. */
export function orderBy(sort, dir, allowed, fallback) {
  const f = allowed.includes(sort) ? sort : fallback;
  return { [f]: dir };
}

// A real calendar date between 2000 and 2100 (rejects half-typed values such as 0002-12-04 or 2026-02-30).
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date (YYYY-MM-DD)').refine((v) => {
  const y = Number(v.slice(0, 4)); if (y < 2000 || y > 2100) return false;
  const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Enter a real date between the years 2000 and 2100');
export const uuid = z.string().uuid();
export const toDate = (s) => (s == null ? s : new Date(`${s}T00:00:00.000Z`));
export const fmtDate = (d) => (d ? d.toISOString().slice(0, 10) : null);
