---
name: automation-script-verification
description: >
  Verification workflow for modifying Google browser automation scripts
  (checkOne.ts, change2fa.ts, checkFamily.ts, google-auth.ts, etc.).
  Use this skill whenever you are about to edit or have just edited any
  Playwright-based automation script in this project.
---

# Automation Script Verification Skill

## When This Skill Applies

Activate this skill whenever you:
- Modify **any** of the following files:
  - `checkOne.ts`
  - `change2fa.ts`
  - `checkFamily.ts`
  - `google-auth.ts`
  - Any file imported by the above (e.g. shared helpers)
- Propose changes to browser interaction logic: navigation, login flows,
  element selectors, TOTP handling, scraping, CDP helpers.

---

## Rule 1 — Examine Before Editing (if uncertain)

If your knowledge of the **target page's DOM structure, flow, or Google's
current UI** is insufficient to confidently write the change:

1. Use the `browser_subagent` tool to **open the actual page** and inspect it.
2. Navigate to the relevant Google URL (e.g. accounts.google.com, myaccount.google.com, one.google.com).
3. Observe: element selectors, text content, page flow, interstitial screens.
4. Only write code after you have confirmed the actual page structure.

**Do not guess at selectors, text variants, or page flow from memory.**
Google's UI changes frequently and assumptions lead to broken automation.

Examples of when to browse first:
- Adding a new selector for a button/input you haven't seen recently
- Handling a new interstitial or challenge screen
- Scraping new data fields from a page

---

## Rule 2 — Verify After Editing (always)

After modifying any automation script, **verify it works** before considering
the task complete. There are two equivalent approaches — choose whichever is
most convenient:

### Option A — Use the running app (preferred for integration testing)

The Next.js dev server (`bun dev`) is always running. Use the app UI to
trigger the corresponding action for a real account, then trace the execution
via the pino log stream.

**Trigger via UI:**
- **Single check**: Open the app → click ⚡ Check on any account row
- **Bulk check**: Click ⚡ Check All or ☑ Check Selected
- **Single 2FA rotation**: Click 🔐 2FA on any account row
- **Bulk 2FA rotation**: Select accounts → click 🔐 Rotate 2FA

**Trace logs with pino** (`bun logs:tail` is already running):
```bash
# It's already running as a persistent terminal — just read its output.
# The feature tag filters by which script/route is executing:
#   feature: "bulk-2fa"       → bulk-change2fa route + change2fa-worker
#   feature: "2fa"            → run-change2fa route
#   feature: "bulk-check"     → bulk-check route + check-worker
#   feature: "check"          → check route
#   feature: "gpm-pool"       → browser pool acquire/release
#   feature: "hybrid-store"   → account store Sheet + DB operations
```

**What to look for in pino logs:**
- `INFO  task | done ✓` — script succeeded, secret/credits persisted
- `ERROR task | FAILED` → `err: "..."` — script failed, see error message
- `DEBUG spawning change2fa` / `DEBUG spawning checkOne` — script started
- `DEBUG change2fa exited` / `DEBUG checkOne exited` + `code: 0` — clean exit
- `INFO  acquire | browser ready` — GPM pool browser is up
- `INFO  release | GPM stop OK` — browser released cleanly

**Pino log format reference:**
```
[HH:MM:SS.mmm] LEVEL (pid): message
    feature: "feature-name"
    email: "account@gmail.com"
    err: "error text if any"
```

---

### Option B — Run the script directly from terminal

Use when you need isolated testing without going through the full API stack.

```bash
# checkOne.ts
ACCOUNT_JSON='{"email":"test@gmail.com","password":"..","totpSecret":".."}' \
  bun checkOne.ts

# change2fa.ts
ACCOUNT_JSON='{"email":"test@gmail.com","password":"..","totpSecret":".."}' \
  bun change2fa.ts

# checkFamily.ts
bun checkFamily.ts '{"email":"test@gmail.com","password":"..","totpSecret":".."}'

# With GPM CDP port (pool mode):
ACCOUNT_JSON='{"email":"test@gmail.com","password":"..","totpSecret":"..","debugPort":9222}' \
  bun checkOne.ts
```

**What to check:**
- **stdout**: Must be valid JSON with `"success": true` and expected fields
- **stderr**: Scan for `Error:` or unexpected branches
- **Screenshot**: If `success: false`, check `public/screenshots/` for the error capture

---

### Always run TypeScript check

```bash
npx tsc --noEmit
```

Zero errors required before considering any edit complete.

---

## Rule 3 — Interpret Failures Correctly

| Pino / stderr error | Likely cause |
|---|---|
| `TOTP input not found (sensitive-action)` | Method chooser interstitial — needs click on "Google Authenticator" first |
| `TOTP input not found (login)` | Same interstitial during initial login |
| `Login did not complete — still on: ...` | Session cookie stale or login flow changed |
| `No page target on port N` | GPM browser not started / CDP not ready |
| `Empty stdout from change2fa` | Script crashed before writing JSON — read stderr |
| `change2fa script reported failure` | Script ran but returned `success: false` |
| `pool acquire failed` | GPM API unreachable or profile not found |
| TypeScript errors | Fix before running — broken types = broken runtime |

---

## Rule 4 — Do Not Assume Google UI Is Stable

Google's account management pages change silently. When an automation
script starts failing intermittently after working before:

1. Use `browser_subagent` to **manually reproduce** the failing step.
2. Inspect the actual page at the point of failure.
3. Update selectors / flow accordingly.
4. Re-run via app or direct invocation.

---

## Workflow Summary

```
Planning to edit automation script?
  │
  ├─ Sufficient knowledge of page? ──NO──► browser_subagent: inspect page first
  │        │
  │       YES
  │        │
  └─────► Make edit
           │
           ► npx tsc --noEmit                    (must pass — zero errors)
           │
           ► Verify (choose one):
           │   A. Trigger via app UI → read pino logs (bun logs:tail)
           │   B. bun <script>.ts <args> → check stdout + stderr
           │
           ├─ Fails? ──► Read pino ERROR lines / stderr / screenshot
           │             ──► Fix ──► Re-run
           │
           └─ Passes? ──► Done ✓
```
