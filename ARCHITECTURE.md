# ggchecks — Architecture & Reference

> **Last updated:** 2026-03-27  
> Full reference for the Google AI Credit Checker dashboard — architecture, data flow, environment config, and extension guide.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [Environment Variables](#4-environment-variables)
5. [Core Modules](#5-core-modules)
6. [API Routes](#6-api-routes)
7. [Data Flow — Single Check](#7-data-flow--single-check)
8. [Data Flow — Bulk Check](#8-data-flow--bulk-check)
9. [Sequence Diagrams](#9-sequence-diagrams)
10. [Chrome Pool Design](#10-chrome-pool-design)
11. [Google Auth Flow](#11-google-auth-flow)
12. [Google Sheets Schema](#12-google-sheets-schema)
13. [SSE Event Reference](#13-sse-event-reference)
14. [Key Design Decisions](#14-key-design-decisions)
15. [Running Locally](#15-running-locally)
16. [Extending the System](#16-extending-the-system)

---

## 1. Project Overview

**ggchecks** is a Next.js dashboard that automates checking Google AI credit balances for multiple Google accounts. It uses Playwright to drive Chrome via CDP (Chrome DevTools Protocol) in a persistent, session-caching mode to avoid bot detection.

**What it does:**
- Reads account credentials (email, password, TOTP secret) from a Google Sheet
- Logs into Google accounts using Playwright automation
- Scrapes the [Google One AI Activity page](https://one.google.com/ai/activity)
- Extracts monthly credits, additional credits, expiry dates, and family member usage
- Writes results back to the Google Sheet
- Streams live progress to the UI via Server-Sent Events (SSE)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, `runtime = 'nodejs'`) |
| **Runtime** | Bun (dev) / Node.js (production subprocess via `npx tsx`) |
| **Browser Automation** | Playwright (Chromium) via CDP |
| **TOTP** | `otplib` — generates 6-digit codes from stored secrets |
| **Google Sheets** | `google-spreadsheet` v5 + `google-auth-library` (JWT service account) |
| **Streaming** | Native `ReadableStream` → Server-Sent Events |
| **UI** | React 19, Vanilla CSS |
| **2FA QR Decode** | `jimp` + `jsqr` (used in `change2fa.ts`) |

---

## 3. Directory Structure

```
ggchecks/
├── checkOne.ts              # Single account credit checker (subprocess entry point)
├── google-auth.ts           # Shared Playwright/Google auth helpers
├── change2fa.ts             # 2FA TOTP rotation script
├── accounts.json            # Local fallback accounts (NOT committed)
├── results.json             # Local result cache (NOT committed)
│
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main dashboard UI
│   │   ├── globals.css                 # Design system + CSS variables
│   │   └── api/
│   │       ├── check/route.ts          # POST — single account check (SSE)
│   │       ├── bulk-check/route.ts     # POST — bulk account check (SSE)
│   │       ├── accounts/route.ts       # GET/POST/DELETE — Google Sheets CRUD
│   │       └── chrome-status/route.ts  # GET — probe Chrome CDP port
│   │
│   ├── components/
│   │   ├── CheckModal.tsx       # Single check UI (logs + results)
│   │   └── BulkCheckModal.tsx   # Bulk check UI (progress table + SSE)
│   │
│   └── lib/
│       ├── chrome-pool.ts       # Chrome slot manager (CONCURRENCY slots)
│       └── sheets.ts            # Google Sheets CRUD helpers
│
└── .env.local                   # Secrets (NOT committed)
```

---

## 4. Environment Variables

All secrets live in `.env.local` (never committed).

```bash
# Google Sheets — service account credentials
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

# Checker script path (defaults to ./checkOne.ts)
CHECKER_PATH=/absolute/path/to/checkOne.ts

# Chrome pool config (bulk-check)
BULK_CONCURRENCY=10          # number of parallel Chrome instances
BULK_BASE_PORT=9300          # first CDP port (9300, 9301, ... 9309)
BULK_PROFILE_DIR=/tmp/ggchecks-profiles   # persistent Chrome profile root

# Chrome binary path (auto-detected on macOS/Linux/Windows if unset)
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

---

## 5. Core Modules

### `google-auth.ts`

Shared browser automation helpers imported by `checkOne.ts` and `change2fa.ts`.

| Export | Description |
|---|---|
| `sleep(ms)` | Promise-based delay |
| `log(msg)` | Timestamped stderr logger |
| `generateTOTP(secret)` | Generates 6-digit TOTP code via `otplib` |
| `createBrowser()` | Launches a fresh headless Chromium with anti-bot args |
| `createBrowserCDP(port)` | Connects to existing Chrome on `port` via CDP (persists session) |
| `createBrowserCDPFresh(port)` | CDP connection + new isolated context (incognito-like) |
| `googleLogin(page, email, pw, totp)` | Full login flow: email → password → TOTP → passkey dismiss |
| `fillAndSubmitTOTP(page, secret, label)` | Finds TOTP input, generates & fills code, waits for redirect |
| `reVerifyForSensitivePage(...)` | Re-auth flow for Google security settings pages |

---

### `checkOne.ts`

Subprocess entry point. Accepts account credentials via `ACCOUNT_JSON` env var, runs the check, prints a JSON result to stdout.

**Input (env var `ACCOUNT_JSON`):**
```json
{
  "email": "user@gmail.com",
  "password": "hunter2",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "debugPort": 9300
}
```

**Output (stdout):**
```json
{
  "success": true,
  "account": "user@gmail.com",
  "checkAt": "2026-03-27T20:00:00.000Z",
  "monthlyCredits": "1,000",
  "additionalCredits": "500",
  "additionalCreditsExpiry": "April 30, 2026",
  "memberActivities": [
    { "name": "Alice", "credit": 200, "checkAt": "..." },
    { "name": "Bob",   "credit": 150, "checkAt": "..." }
  ]
}
```

**Error output (stdout):**
```json
{ "success": false, "account": "user@gmail.com", "error": "Login did not complete" }
```

**Logic:**
1. Parse `ACCOUNT_JSON`
2. If `debugPort` → `createBrowserCDP(port)` (stealth/session-cache mode)  
   Else → `createBrowser()` (fresh Playwright browser)
3. Navigate to AccountChooser URL (CDP mode) or directly to activity URL (fresh mode)
4. If redirected to `accounts.google.com` → call `googleLogin()`
5. If NOT redirected → session cache hit, skip login
6. Call `scrapeActivityPage()` — extracts credit data from `document.body.innerText`
7. Write JSON to stdout; on CDP mode, `browser.close()` disconnects only (Chrome stays alive)

---

### `src/lib/chrome-pool.ts`

Manages a fixed pool of persistent Chrome instances for concurrent bulk checking.

```
Slots: port 9300, 9301, ..., 9300+CONCURRENCY-1
Each slot: one Chrome process, one persistent profile directory
```

| Export | Description |
|---|---|
| `CONCURRENCY` | Number of slots (default 10, from `BULK_CONCURRENCY`) |
| `BASE_PORT` | First port (default 9300, from `BULK_BASE_PORT`) |
| `PROFILE_DIR` | Profile root (`/tmp/ggchecks-profiles` by default) |
| `getChromePath()` | Resolves Chrome binary path (env var or OS default) |
| `ensureChrome(port)` | Starts Chrome on `port` if not running; polls up to 15 s |
| `waitForSlot()` | Returns `{ port, release() }` — polls every 200 ms until a slot is free |

**Slot lifecycle:**
1. `waitForSlot()` → marks slot as `BUSY`, returns port + `release`
2. `ensureChrome(port)` → Chrome process starts (or is already running — no-op)
3. Subprocess runs on that port
4. `release()` called in `finally` → slot returns to `FREE`

---

### `src/lib/sheets.ts`

Google Sheets CRUD via `google-spreadsheet` v5 with JWT service account auth.

**Sheet:** `Accounts` (auto-created if missing)

| Function | Description |
|---|---|
| `getAccounts()` | Returns all rows as `Account[]` |
| `addAccount(account)` | Adds a new row with `status: 'pending'` |
| `updateCreditResult(rowIndex, data)` | Writes credit check results to a specific row |
| `update2FASecret(rowIndex, totpSecret)` | Updates the TOTP secret for a row |
| `deleteAccount(rowIndex)` | Deletes a row |
| `ensureSheetExists()` | Creates sheet + headers if not present |

**Note:** `rowIndex` is 1-based; row 1 = header. Data starts at row 2 → `rows[rowIndex - 2]`.

---

## 6. API Routes

### `POST /api/check` — Single Account Check

**Request body:**
```json
{
  "email": "user@gmail.com",
  "password": "hunter2",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "rowIndex": 3,
  "debugPort": 9222
}
```

- If `debugPort` provided: runs `npx tsx checkOne.ts` (CDP/stealth mode)
- If no `debugPort`: runs `bun checkOne.ts` (fresh Playwright browser)
- Stderr from subprocess → SSE `{ type: "log", message }` events
- On completion → writes to Sheets, sends SSE result/error/done events

**SSE events:** `log` | `result` | `error` | `done`

---

### `POST /api/bulk-check` — Bulk Account Check

**Request body:**
```json
{
  "accounts": [
    { "rowIndex": 2, "email": "...", "password": "...", "totpSecret": "..." },
    ...
  ]
}
```

- All accounts dispatched in parallel (limited by `CONCURRENCY` slots)
- Uses `chrome-pool.ts` for slot management
- Always uses CDP mode via `npx tsx checkOne.ts`
- Each account gets its own Chrome slot with a persistent profile

**SSE events:** `start` | `account_start` | `chrome_ready` | `account_done` | `account_error` | `done`

---

### `GET /api/accounts` — List Accounts

Returns all accounts from Google Sheets as JSON array.

### `POST /api/accounts` — Add Account

Body: `{ email, password, totpSecret }`

### `DELETE /api/accounts?rowIndex=N` — Delete Account

---

### `GET /api/chrome-status?port=9222` — Chrome Health Check

Probes `http://localhost:<port>/json/version`. Used by `CheckModal` to show Chrome status badge.

---

## 7. Data Flow — Single Check

```
UI (CheckModal)
  │
  │  POST /api/check { email, password, totpSecret, rowIndex, debugPort? }
  ▼
Next.js API Route (/api/check)
  │
  │  exec "npx tsx checkOne.ts"  [or "bun checkOne.ts"]
  │  env: ACCOUNT_JSON={"email","password","totpSecret","debugPort?"}
  ▼
checkOne.ts (subprocess)
  │
  ├─ createBrowserCDP(port)   [if debugPort]
  │    └─ connectOverCDP(localhost:port) → use existing Chrome + profile
  │
  ├─ createBrowser()          [if no debugPort]
  │    └─ chromium.launch() → fresh browser, no persistent profile
  │
  ├─ Navigate to AccountChooser (CDP) or ACTIVITY_URL (fresh)
  │
  ├─ if redirected to accounts.google.com:
  │    └─ googleLogin(page, email, password, totpSecret)
  │         ├─ fill email → Enter
  │         ├─ fill password → Enter
  │         ├─ [if TOTP] generateTOTP(secret) → fill → Enter → waitForURL
  │         └─ dismissPasskeyPrompt()
  │
  ├─ scrapeActivityPage(page)
  │    └─ page.evaluate(inline JS) → parse innerText for credits + members
  │
  └─ stdout: JSON result
       │
  ▼ (back in API route)
Next.js API Route
  ├─ SSE: log lines from stderr
  ├─ updateCreditResult(rowIndex, data)  → Google Sheets
  └─ SSE: result | error | done
       │
  ▼
UI (CheckModal)
  └─ Display logs + result card
```

---

## 8. Data Flow — Bulk Check

```
UI (BulkCheckModal)
  │
  │  POST /api/bulk-check { accounts: [...] }
  ▼
Next.js API Route (/api/bulk-check)
  │
  │  SSE: { type:"start", total, concurrency }
  │
  │  Promise.all(accounts.map(account => ...))
  │    │
  │    ├─ waitForSlot()          ← blocks until a Chrome slot (port 930x) is free
  │    ├─ ensureChrome(port)     ← starts Chrome if not already running
  │    │    └─ spawn chrome --user-data-dir=slot-930x --remote-debugging-port=930x
  │    │
  │    ├─ SSE: { type:"chrome_ready", port }
  │    │
  │    ├─ exec "npx tsx checkOne.ts" [ACCOUNT_JSON with debugPort]
  │    │    └─ (same as single check flow above)
  │    │
  │    ├─ JSON.parse(stdout)
  │    │
  │    ├─ updateCreditResult(rowIndex, data)  → Google Sheets
  │    │
  │    ├─ SSE: { type:"account_done" | "account_error", rowIndex, result|error }
  │    │
  │    └─ release()    ← slot 930x is free for next account
  │
  │  SSE: { type:"done", completed, errors }
  ▼
UI (BulkCheckModal)
  └─ Progress table updates in real-time, summary on done
```

---

## 9. Sequence Diagrams

### Full Bulk Check (simplified)

```
UI          API/bulk-check   chrome-pool      Chrome:930x      checkOne.ts     Google       Sheets
 │─POST──────────►│                                                                             │
 │◄──SSE:start────│                                                                             │
 │                │─waitForSlot()──►│                                                           │
 │                │◄──{port,rel}────│                                                           │
 │◄──SSE:acc_start│                 │                                                           │
 │                │─ensureChrome───►│                                                           │
 │                │                 │─spawn/probe──►│                                           │
 │◄──SSE:chrome_rdy│                │               │                                           │
 │                │─exec npx tsx────────────────────────►│                                      │
 │                │                                       │─connectOverCDP──►│                  │
 │                │                                       │─AccountChooser──────────►Google.com │
 │                │                                       │  [session HIT or googleLogin()]      │
 │                │                                       │─scrapeActivityPage──────►Google One  │
 │                │◄──────────────────stdout JSON─────────│                                     │
 │                │─updateCreditResult──────────────────────────────────────────────►│           │
 │◄──SSE:acc_done─│                                                                             │
 │                │─release()──────►│  (slot free)                                              │
 │◄──SSE:done─────│                                                                             │
```

---

## 10. Chrome Pool Design

### Pool Initialization

At startup, `chrome-pool.ts` initializes `CONCURRENCY` slots (default 10):

```
Port 9300 → FREE    (profile: /tmp/ggchecks-profiles/slot-9300/)
Port 9301 → FREE    (profile: /tmp/ggchecks-profiles/slot-9301/)
...
Port 9309 → FREE    (profile: /tmp/ggchecks-profiles/slot-9309/)
```

### Slot State Machine

```
FREE ──waitForSlot()──► BUSY ──release()──► FREE
                          │
                     ensureChrome(port)
                          │
                   ┌──────┴───────┐
                   │ Already up?  │
                   │ GET /json/   │
                   │ version → OK │  ← no-op
                   └──────────────┘
                   ┌──────────────┐
                   │ Not running  │
                   │ spawn Chrome │ ← detached, unref'd
                   │ poll 500ms   │
                   │ timeout 15s  │
                   └──────────────┘
```

### Why Persistent Chrome?

- Each Chrome slot stores its profile in a dedicated directory
- Google session cookies are saved between runs
- On subsequent checks for the same account on the same slot → **session cache hit** → login skipped
- CDP connection (`browser.close()`) disconnects Playwright but **does NOT kill Chrome** — the process keeps running with cookies intact

---

## 11. Google Auth Flow

### Normal Login (`googleLogin`)

```
1. waitForSelector input[type=email]
2. fill(email) → Enter
3. waitForSelector input[type=password] (visible)
4. sleep(500ms)
5. fill(password) → Enter
6. sleep(2500ms)

Check for TOTP:
  - URL includes "signin/challenge"
  - Body includes "2-Step Verification" / "authenticator" / "Enter the code"
  - OR: totpPin / aria-label*=code input is visible

If TOTP needed:
  7. Poll for TOTP input (up to 10 × 500ms)
  8. generateTOTP(secret) via otplib
  9. fill(code) → Enter
  10. waitForURL (not accounts.google.com, 15s timeout)
  11. sleep(1000ms)

If no TOTP:
  7. waitForURL (not accounts.google.com, 10s timeout)

Passkey dismissal:
  - Check body for "Simplify your sign-in" / "passkey"
  - Click "Not now" button programmatically
  - waitForURL redirect

Final check:
  - If still on accounts.google.com → throw Error
```

### Session Cache Check (`checkOne.ts`)

```
CDP mode only:
1. Navigate to AccountChooser?Email=<email>&continue=<ACTIVITY_URL>
2. sleep(1500ms)
3. if page.url().includes('accounts.google.com'):
     → cache MISS → call googleLogin()
   else:
     → cache HIT → log "Session cache hit — skipping login"
```

### Sensitive Page Re-auth (`reVerifyForSensitivePage`)

Used by `change2fa.ts` when navigating to security settings:
- Handles email re-entry (if shown)
- Handles password re-entry (if shown)
- Handles TOTP challenge (if shown)
- Navigates back to target URL if still stuck

---

## 12. Google Sheets Schema

**Sheet name:** `Accounts`

| Column | Description | Type |
|---|---|---|
| `email` | Google account email | String |
| `password` | Account password | String |
| `totpSecret` | Base32 TOTP secret | String |
| `monthlyCredits` | Current monthly AI credits (raw string, e.g. "1,000") | String |
| `additionalCredits` | Additional/bonus AI credits | String |
| `additionalCreditsExpiry` | Expiry date text (e.g. "April 30, 2026") | String |
| `memberActivities` | Pipe-separated family members: `"Alice: 200 \| Bob: 150"` | String |
| `lastChecked` | ISO 8601 timestamp of last successful check | String |
| `status` | `"ok"` or `"error: <message>"` or `"pending"` | String |

**Row indexing:** Row 1 = header. `rowIndex` in code is 1-based, data rows start at 2.  
`rows[rowIndex - 2]` in JavaScript (0-indexed array of data rows).

---

## 13. SSE Event Reference

### `/api/bulk-check` Events

| Event `type` | Payload | Description |
|---|---|---|
| `start` | `{ total, concurrency }` | Bulk run begins |
| `account_start` | `{ rowIndex, email, port }` | Account dequeued, Chrome slot claimed |
| `chrome_ready` | `{ port }` | Chrome is running and accepting CDP |
| `account_done` | `{ rowIndex, result }` | Account check succeeded |
| `account_error` | `{ rowIndex, error }` | Account check failed |
| `done` | `{ completed, errors }` | All accounts finished |
| `fatal` | `{ message }` | Unrecoverable error (rare) |

### `/api/check` Events

| Event `type` | Payload | Description |
|---|---|---|
| `log` | `{ message }` | Subprocess stderr line |
| `result` | `{ data: CheckResult }` | Successful check result |
| `error` | `{ message }` | Check failed |
| `done` | `{}` | Stream complete |

---

## 14. Key Design Decisions

### Why CDP instead of a fresh Playwright browser?

| Approach | Bot Detection Risk | Session Caching | Speed |
|---|---|---|---|
| Fresh `chromium.launch()` | High — new fingerprint each time | None | Slow (full login every run) |
| CDP to persistent Chrome | Low — real browser, real profile | ✅ Survives between runs | Fast (login skipped on cache hit) |

### Why `npx tsx` for CDP subprocesses?

Bun's WebSocket implementation doesn't fully support `connectOverCDP`. `npx tsx` runs in Node.js, where Playwright's CDP connection works reliably.

### Why subprocesses instead of running Playwright in the Next.js process?

- Isolation: a crash in one check doesn't affect others
- Concurrency: each subprocess gets its own Node.js event loop
- Separation: Next.js stays responsive while long-running automation runs

### Why SSE instead of WebSockets?

- SSE is unidirectional (server→client) which matches the use case exactly
- Native browser `ReadableStream` support in Next.js App Router
- No setup overhead, works through HTTP/2

### Why not use Puppeteer?

Playwright has better CDP multi-context support, more robust auto-waiting, and first-class TypeScript types.

---

## 15. Running Locally

### Prerequisites

- Node.js 20+ and/or Bun
- Google Chrome installed
- A Google Cloud service account with Sheets API access
- A Google Sheet shared with the service account email

### Setup

```bash
# Install dependencies
bun install

# Copy and fill in secrets
cp .env.local.example .env.local
# Edit .env.local with your credentials

# Start the dev server
bun dev
```

### Single Account Check (CLI)

```bash
ACCOUNT_JSON='{"email":"user@gmail.com","password":"pw","totpSecret":"SECRET"}' \
  bun checkOne.ts
```

### Stealth Mode — CDP (CLI)

```bash
# 1. Launch Chrome with remote debugging
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-test

# 2. Run checker against it
ACCOUNT_JSON='{"email":"...","password":"...","totpSecret":"...","debugPort":9222}' \
  npx tsx checkOne.ts
```

### Change 2FA Secret (CLI)

```bash
bun change2fa.ts
# or
npm run change2fa
```

---

## 16. Extending the System

### Add a new API endpoint

1. Create `src/app/api/<name>/route.ts`
2. Add `export const runtime = 'nodejs'` (required for child process / file system access)
3. Use `ReadableStream` + SSE if streaming output to the UI

### Add a new Chrome pool action

1. Claim a slot: `const { port, release } = await waitForSlot()`
2. Ensure Chrome: `await ensureChrome(port)`
3. Spawn your subprocess with `debugPort: port` in `ACCOUNT_JSON`
4. Always call `release()` in a `finally` block

### Add a new Google Sheets column

1. Add the column name to `HEADER_ROW` in `src/lib/sheets.ts`
2. Update the `Account` interface
3. Update `getAccounts()`, `updateCreditResult()` as needed
4. Re-run `ensureSheetExists()` to add the header (or add manually in Sheets)

### Add a new scraping field

1. Update the inline JS in `scrapeActivityPage()` in `checkOne.ts`
2. Update `ActivityData` and `CheckResult` interfaces
3. Update `updateCreditResult()` call in both API routes
4. Add the new column to `sheets.ts`

---

*Generated from source: `checkOne.ts`, `google-auth.ts`, `chrome-pool.ts`, `sheets.ts`, `api/check/route.ts`, `api/bulk-check/route.ts`, `BulkCheckModal.tsx`, `CheckModal.tsx`*
