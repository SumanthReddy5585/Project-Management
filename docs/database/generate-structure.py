#!/usr/bin/env python3
"""Regenerate DATABASE-STRUCTURE.md and DATABASE-STRUCTURE.html from a live O2 Support Hub database.

Usage:  python3 generate-structure.py "postgresql://user:pass@host:5432/dbname"
Needs:  psql on PATH, Python 3 with the 'markdown' package (pip install markdown).
Table descriptions and groupings are kept from the existing DATABASE-STRUCTURE.md; new tables land in "Other".
"""
import datetime, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(HERE, 'DATABASE-STRUCTURE.md')
HTML_PATH = os.path.join(HERE, 'DATABASE-STRUCTURE.html')
URL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('DATABASE_URL')
if not URL:
    sys.exit('usage: generate-structure.py DATABASE_URL')


def q(sql):
    out = subprocess.run(['psql', URL, '-XAt', '-F', '\x1f', '-c', sql], check=True, capture_output=True, text=True).stdout
    return [line.split('\x1f') for line in out.splitlines() if line]


# --- keep curated descriptions and groups from the previous document ---
old = open(MD_PATH, encoding='utf-8').read() if os.path.exists(MD_PATH) else ''
desc = {m.group(1): m.group(2).strip() for m in re.finditer(r'^### (\S+)\n\n(?!\|)(.+?)\n\n', old, re.M)}
groups = []
for m in re.finditer(r'^- \*\*(.+?)\*\*: (.+)$', old, re.M):
    groups.append((m.group(1), re.findall(r'\[([^\]]+)\]\(#', m.group(2))))

tables = [r[0] for r in q("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")]
known = {t for _, ts in groups for t in ts}
groups = [(g, [t for t in ts if t in tables]) for g, ts in groups]
extra = [t for t in tables if t not in known]
if extra:
    groups.append(('Other', extra))
groups = [(g, ts) for g, ts in groups if ts]

cols = {}
for t, c, typ, nn, dflt in q("""
  select c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname, a.attnum"""):
    typ = (typ.replace('timestamp(3) with time zone', 'timestamptz').replace('timestamp with time zone', 'timestamptz')
              .replace('timestamp(3) without time zone', 'timestamp').replace('character varying', 'varchar').replace('"', ''))
    cols.setdefault(t, []).append([c, typ, nn == 't', dflt])

pk = {}
for t, c in q("""select tc.table_name, kcu.column_name from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
  where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY'"""):
    pk.setdefault(t, set()).add(c)

ACT = {'a': 'no action', 'r': 'restrict', 'c': 'cascade', 'n': 'set null', 'd': 'set default'}
fks = []
for t, c, rt, rc, act in q("""select cl.relname, a.attname, rcl.relname, ra.attname, con.confdeltype
  from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_class rcl on rcl.oid=con.confrelid
  join pg_namespace n on n.oid=cl.relnamespace
  join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
  join pg_attribute ra on ra.attrelid=con.confrelid and ra.attnum=con.confkey[1]
  where con.contype='f' and n.nspname='public' order by 1,2"""):
    fks.append((t, c, rt, rc, ACT.get(act, act)))
fkmap = {(t, c): (rt, rc, a) for t, c, rt, rc, a in fks}

idx = {}
for t, name, ddl in q("""select tablename, indexname, indexdef from pg_indexes where schemaname='public'
  and indexname not in (select constraint_name from information_schema.table_constraints where constraint_type='PRIMARY KEY' and table_schema='public')
  order by tablename, indexname"""):
    m = re.search(r'USING \w+ \((.*)\)', ddl)
    cols_txt = m.group(1) if m else ddl
    idx.setdefault(t, []).append(('unique ' if 'UNIQUE' in ddl else '') + '(' + cols_txt + ')')

enums = q("""select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_type t
  join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by 1 order by 1""")
triggers = q("""select tg.tgname, c.relname, p.proname from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
  join pg_proc p on p.oid=tg.tgfoid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not tg.tgisinternal order by 2""")
migs = q('select migration_name from "_prisma_migrations" where finished_at is not null order by migration_name')

today = datetime.date.today().isoformat()
L = []
w = L.append
w('# O2 Support Hub - Database structure\n')
w(f'PostgreSQL schema `public` · {len(tables)} tables · {len(enums)} enum types · {len(fks)} foreign keys · '
  f'{sum(len(v) for v in idx.values())} indexes · {len(migs)} migrations · generated {today}\n')
w('All primary keys are UUIDs. Timestamps are `timestamptz` (UTC); plain dates are `date`. Every business table is scoped to an '
  'organisation, directly or through its project. The original (approved) plan is protected by the trigger '
  '`o2_protect_original_baseline` on `Baseline` and `BaselineItem`. Columns ending in `Id` without an arrow (for example '
  '`assigneeId`, `createdById`) point to a row in another table — usually `User` — and are checked by the application rather '
  'than by a database foreign key. The authoritative model definition is `prisma/schema.prisma`; the SQL history is in '
  '`prisma/migrations/`.\n')
w('## Contents\n')
for g, ts in groups:
    w(f'- **{g}**: ' + ', '.join(f'[{t}](#{t.lower().replace("_", "")})' for t in ts))
w('- [Relationship diagram](#relationship-diagram) · [Enum types](#enum-types) · [Triggers](#triggers) · [Migrations](#migrations)\n')

w('## Relationship diagram\n')
w('Main relationships (lookup links such as created-by/updated-by are omitted for readability). GitHub, VS Code and most '
  'Markdown viewers render this diagram.\n')
w('```mermaid\nerDiagram')
for t, c, rt, rc, a in sorted(fks):
    if rt == t or (rt == 'User' and c not in ('userId',)):
        continue
    w(f'  {rt} ||--o{{ {t} : "{c}"')
w('```\n')

w('## Enum types\n')
w('| Type | Values |\n|---|---|')
for name, vals in enums:
    w(f'| `{name}` | {vals} |')
w('')
w('## Triggers\n')
w('| Trigger | Table | Function | Purpose |\n|---|---|---|---|')
for tg, t, fn in triggers:
    purpose = 'Blocks UPDATE/DELETE of the original (first approved) baseline so the agreed plan can never be changed' if 'protect' in fn else ''
    w(f'| `{tg}` | `{t}` | `{fn}()` | {purpose} |')
w('')
w('## Migrations\n')
w('Applied automatically, in order, by `scripts/db-migrate.js` on every start (already-applied ones are skipped).\n')
for (m,) in migs:
    w(f'1. `{m}`')
w('')

for g, ts in groups:
    w(f'## {g}\n')
    for t in ts:
        w(f'### {t}\n')
        if t in desc:
            w(desc[t] + '\n')
        w('| Column | Type | Null | Default | Key / reference |\n|---|---|---|---|---|')
        for c, typ, nn, dflt in cols.get(t, []):
            key = '**PK**' if c in pk.get(t, ()) else ''
            if (t, c) in fkmap:
                rt, rc, a = fkmap[(t, c)]
                key = (key + ' ' if key else '') + f'→ `{rt}.{rc}` (on delete {a})'
            d = f'`{dflt}`' if dflt else ''
            w(f'| `{c}` | {typ} | {"no" if nn else "yes"} | {d.replace("|", chr(92) + "|")} | {key} |')
        if idx.get(t):
            w('\nIndexes: ' + '; '.join(idx[t]))
        w('')

md = '\n'.join(L)
open(MD_PATH, 'w', encoding='utf-8').write(md)

import markdown
body = markdown.markdown(md, extensions=['tables', 'fenced_code', 'toc'])
body = re.sub(r'<pre><code class="language-mermaid">(.*?)</code></pre>', lambda m: '<pre class="mermaid">' + m.group(1) + '</pre>', body, flags=re.S)
html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>O2 Support Hub - Database structure</title>\n<style>'
        'body{font:14px/1.55 "Segoe UI",Inter,Arial,sans-serif;max-width:1120px;margin:2rem auto;padding:0 1rem;color:#0f172a}'
        'h1{border-bottom:3px solid #0a3df0;padding-bottom:.4rem}h2{margin-top:2.4rem;border-bottom:1px solid #e2e8f0;padding-bottom:.3rem}'
        'h3{margin-top:1.7rem;color:#0a3df0}table{border-collapse:collapse;width:100%;font-size:13px;margin:.4rem 0}'
        'th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f6f6f7}'
        'code{background:#f1f5f9;padding:0 3px;border-radius:3px;font-size:12px}'
        'pre.mermaid{background:#fff;border:1px solid #e2e8f0;padding:1rem;overflow:auto;font-size:12px}'
        '@media print{pre.mermaid{display:none}h2{page-break-before:auto}}</style>\n'
        '<script type="module">try{const m=await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");'
        'm.default.initialize({startOnLoad:true,er:{useMaxWidth:false}});}catch(e){}</script>\n'
        '</head><body>' + body + '</body></html>\n')
open(HTML_PATH, 'w', encoding='utf-8').write(html)
print(f'{len(tables)} tables, {len(enums)} enums, {len(fks)} FKs, {len(migs)} migrations -> {MD_PATH}, {HTML_PATH}')
