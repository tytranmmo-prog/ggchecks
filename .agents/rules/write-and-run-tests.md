# Write & Run Tests After Every Non-UI Edit

## When This Rule Applies

**Always** applies after editing any of the following:
- `src/lib/**/*.ts` — store, pool, workers, helpers
- `src/app/api/**/*.ts` — API routes (Next.js handlers)
- `src/lib/store/**/*.ts` — store implementations
- Root-level `.ts` scripts: `checkOne.ts`, `change2fa.ts`, `checkFamily.ts`, `google-auth.ts`

**Does NOT apply to:**
- `*.tsx` — React components
- `src/app/page.tsx` — UI pages
- Styling files: `globals.css`, `tailwind.config.*`, etc.

---

## Test File Conventions

| Source file | Test file location |
|---|---|
| `src/lib/foo.ts` | `src/lib/__tests__/foo.test.ts` |
| `src/lib/store/foo.ts` | `src/lib/store/__tests__/foo.test.ts` |
| `src/app/api/foo/route.ts` | `src/app/api/foo/__tests__/route.test.ts` |

If no test file exists yet → create it alongside the source file.

---

## Testing Stack

- **Runner**: `bun test` (uses `bun:test` — NOT jest, NOT vitest)
- **Imports**: `import { describe, test, it, expect, mock, beforeEach, afterEach } from 'bun:test'`
- **Mocking**: `mock.module('path/to/module', () => ({ ... }))` — declared at module level, hoisted before imports
- **TypeScript**: All test files use `.ts`, not `.js`

### Always silence pino in tests
```ts
mock.module('@/lib/pino-logger', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child() { return logger; } };
  return { createLogger: () => logger };
});
```

---

## What to Test

For each change, write tests that cover:

1. **Happy path** — normal inputs produce expected outputs
2. **Edge cases** — empty inputs, null/undefined, zero values
3. **Error paths** — exceptions from dependencies are handled correctly
4. **Side effects** — correct methods were called (or NOT called) on mocks

---

## Running Tests

```bash
# Run only the test file for the edited source
bun test src/lib/__tests__/foo.test.ts

# Run full suite to check for regressions
bun test

# TypeScript check (always run too)
npx tsc --noEmit
```

Both `tsc --noEmit` and `bun test` must pass before considering any edit complete.

---

## Workflow

```
Edit a non-UI .ts file
  │
  ├─ Test file exists? NO ──► Create __tests__/<filename>.test.ts
  │                    YES ──► Add/update tests for changed behaviour
  │
  ► npx tsc --noEmit          (fix type errors first)
  ► bun test <test-file>      (run targeted test)
  │
  ├─ Failing? ──► Fix code or test → re-run
  └─ Passing? ──► bun test    (full suite regression check)
                    └─ All green? ──► Done ✓
```

---

## Mock Pattern Reference

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// 1. Declare mocks at module level (hoisted before imports)
const dbMock = {
  getAccounts: mock(async () => []),
  upsert:      mock(async () => {}),
};
mock.module('@/lib/db', () => dbMock);
mock.module('@/lib/pino-logger', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child() { return logger; } };
  return { createLogger: () => logger };
});

// 2. Import the module under test AFTER mocks
import { MyService } from '../my-service';

// 3. Reset between tests
beforeEach(() => {
  Object.values(dbMock).forEach(m => m.mockClear());
  dbMock.getAccounts.mockResolvedValue([]); // restore defaults
});

// 4. Write focused tests
describe('MyService', () => {
  test('returns accounts from db', async () => {
    dbMock.getAccounts.mockResolvedValue([{ id: 1, email: 'a@b.com' }]);
    const svc = new MyService();
    const result = await svc.list();
    expect(result).toHaveLength(1);
    expect(dbMock.getAccounts).toHaveBeenCalledTimes(1);
  });

  test('propagates db errors', async () => {
    dbMock.getAccounts.mockRejectedValue(new Error('db down'));
    const svc = new MyService();
    await expect(svc.list()).rejects.toThrow('db down');
  });
});
```
