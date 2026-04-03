# Database Schema Changes — Always Use Drizzle Migrations

## The Golden Rule

**Never create, alter, or drop tables directly via SQL, Supabase UI, psql, or any other tool.**
**Every schema change MUST go through `schema.ts` → `db:generate` → commit → `db:migrate`.**

Violating this breaks migration tracking and causes "table already exists" failures on other machines.

---

## Correct Workflow for Any Schema Change

### Adding a table / column / index / constraint

```
1. Edit src/lib/schema.ts
2. bun run db:generate       ← generates SQL migration file in drizzle/
3. git add drizzle/ src/lib/schema.ts
4. git commit -m "feat: add <description>"
5. bun run db:migrate        ← applies to local DB
```

### Removing a table / column

Same as above — Drizzle generates the `DROP` statement automatically. Never write it by hand.

### Renaming a column

Add the new column, migrate data, then drop the old one in a subsequent migration. Drizzle does not auto-detect renames.

---

## Key Scripts

| Script | Purpose |
|---|---|
| `bun run db:generate` | Generate SQL migration from schema diff |
| `bun run db:migrate` | Apply pending migrations (uses `migrate.ts`, exits cleanly) |
| `bun run db:studio` | Open Drizzle visual UI (read-only ok, never write) |

`db:generate` and `db:migrate` both load `.env.local` automatically via `bun --env-file`.

---

## Critical Rules

### ❌ Never do this
```sql
-- psql / Supabase / manual SQL
CREATE TABLE foo (...);
ALTER TABLE bar ADD COLUMN baz text;
```

### ✅ Always do this
```ts
// 1. src/lib/schema.ts
export const foo = pgTable('foo', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  baz: text('baz'),
});

// 2. Terminal
// bun run db:generate → drizzle/0002_add_foo.sql
// bun run db:migrate
```

---

## Generated SQL Must Use IF NOT EXISTS for Additive Migrations

When a table might already exist on some machines (e.g. was added in a hotfix), write the migration defensively:

```sql
-- Good: safe on all machines
CREATE TABLE IF NOT EXISTS "foo" (...);

-- FK: wrap in DO block to swallow duplicate errors
DO $$ BEGIN
  ALTER TABLE "foo" ADD CONSTRAINT "foo_bar_id_fk"
    FOREIGN KEY ("bar_id") REFERENCES "bar"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "foo_bar_id_idx" ON "foo" ("bar_id");
```

This is especially important when a table was created manually on one machine before migration tracking was set up.

---

## Recovering a Machine That Has Tables But No Migration History

Use this when a machine already has tables created outside of Drizzle's tracking:

```bash
# 1. Pull latest (which includes drizzle/ migration files)
git pull

# 2. Mark the base migration as already applied
bun --env-file=.env.local -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
const fs = await import('fs');
const { createHash } = await import('crypto');
const content = fs.readFileSync('./drizzle/0000_flashy_expediter.sql', 'utf8');
const hash = createHash('sha256').update(content).digest('hex');
await sql\`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
           VALUES (\${hash}, \${Date.now()}) ON CONFLICT DO NOTHING\`;
console.log('Marked 0000 as applied');
await sql.end();
"

# 3. Run migrate — only applies migrations AFTER 0000
bun run db:migrate
```

---

## Never Edit Generated Migration Files

Once a `.sql` file is committed, **it is immutable**. Its SHA256 hash is stored in `drizzle.__drizzle_migrations`. Editing it will cause:

```
Error: previously executed migration file has been modified
```

To fix a mistake in a migration → generate a new one that corrects it.

---

## Commit Checklist After Any Schema Change

```
drizzle/meta/_journal.json   ← updated by db:generate (commit it)
drizzle/meta/*.json          ← schema snapshots (commit them)
drizzle/XXXX_<name>.sql      ← generated SQL (commit it)
src/lib/schema.ts            ← your source of truth (commit it)
```
