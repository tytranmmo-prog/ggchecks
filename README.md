# GG Checks — Google Account Automation Dashboard

A powerful, stealthy full-stack Next.js application built to manage, automate, and monitor Google One AI credits across multiple Google family accounts. GG Checks uses a local **PostgreSQL** database (previously Google Sheets) to bulk-process accounts, handle mandatory 2FA TOTP logins, bypass bot detection via Chrome DevTools Protocol (CDP), and visually report results in a real-time dashboard.

---

## 🚀 Core Capabilities

1. **Dashboard Interface**
   - Clean, dark-mode Next.js UI backed by a local PostgreSQL database.
   - Real-time SSE (Server-Sent Events) terminal logs streamed directly to the frontend.
   - Per-account check history with member activity breakdown (email, name, credit per member row).

2. **Stealth Operation (CDP Pool)**
   - Uses Playwright purely for isolated session logins and family-member scraping.
   - Automatically disconnects Playwright post-login and uses raw WebSocket CDP commands to bypass Google's `navigator.webdriver` bot detection during credit scraping.
   - Manages a persistent GPM browser profile pool, caching sessions bound to emails to avoid repetitive multi-step logins.

3. **Google Family Member Enrichment**
   - Automatically fetches the full Google Family roster (name, email, role) for each account after login.
   - Maps member activity credits to their email addresses for accurate, email-keyed analytics.
   - All family members are included in check results — members with no activity default to `0` credit.

4. **Automated Google 2FA Bypass**
   - Automatically resolves interstitial 2FA menus and inputs 6-digit TOTP codes derived from your synced Base32 Authenticator secrets.
   - Handles re-authentication challenges when navigating between Google domains mid-session.

5. **Proxy Support**
   - Built-in ISP proxy routing using `proxy-chain` integrated with Oxylabs.
   - Per-account proxy assignment stored in the database for consistent routing.

---

## 🛠 Prerequisites & Installation

- **Runtime**: [Bun](https://bun.sh/) (used for both running scripts and the Next.js app)
- **Database**: PostgreSQL 16+ (or Docker — see below)
- **Browser**: Playwright Chromium binaries

```bash
# 1. Install dependencies
bun install

# 2. Install Playwright Chromium binaries
npx playwright install chromium
```

---

## ⚙️ Configuration

Copy your credentials into `.env.local`:

```env
# PostgreSQL connection string
DATABASE_URL="postgres://ggchecks:secret@localhost:5432/ggchecks"

# Proxy configuration (Oxylabs or compatible ISP proxy)
PROXY_USERNAME="proxy_user"
PROXY_PASSWORD="proxy_password"

# (Optional) Account credentials as JSON, for standalone CLI scripts
# ACCOUNT_JSON='{"email":"...","password":"...","totpSecret":"..."}'
```

> **Note**: The old Google Sheets environment variables (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `DRIVE_SCREENSHOT_FOLDER_ID`) are only needed if you are running the one-time migration from Sheets. They are no longer required for normal operation.

---

## 🐳 Database Setup

### Option A — Docker (Recommended)

Spin up a local PostgreSQL instance in one command:

```bash
docker-compose up -d postgres
```

This starts a `postgres:16-alpine` container with:
- **Database**: `ggchecks`
- **User**: `ggchecks`
- **Password**: `secret`
- **Port**: `5432`
- Data is persisted in a named Docker volume (`pgdata`).

### Option B — Existing PostgreSQL

Point `DATABASE_URL` in `.env.local` at your own instance. The schema is created automatically on first run via `ensureSchema()`.

### Schema Management

The schema is managed via [Drizzle ORM](https://orm.drizzle.team/). To inspect or push schema changes:

```bash
# Generate migration files from schema changes
bun db:generate

# Apply pending migrations
bun db:migrate

# Open Drizzle Studio GUI (browse your DB visually)
bun db:studio
```

### Backup & Restore (Snapshots)

If you need to move your database to another machine or create a backup without worrying about external database hosts (like Supabase), you can use the built-in snapshot commands:

```bash
# 1. Create a snapshot on the current machine
npm run db:snapshot
# (Creates a `db_snapshot.sql` file in your project root containing all database structure and data)

# 2. Apply the snapshot on the new machine
# (Make sure to start the new, empty DB first with `docker-compose up -d postgres`)
npm run db:restore
```

---

## 📦 Migrating from Google Sheets → PostgreSQL

If you were previously using the Google Sheets integration, follow these steps **once** to migrate your account data into the new database.

### 1. Ensure Google Sheets credentials are set

Add these to `.env.local` (only needed for the migration):

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID="your-sheet-id"
```

Your Google Sheet must have these exact column headers on row 1:
- `email`
- `password`
- `totpSecret`

### 2. Start the database

```bash
docker-compose up -d postgres
```

### 3. Run the migration script

```bash
bun scripts/migrate-from-sheets.ts
```

The script will:
- Connect to PostgreSQL and create the schema if needed.
- Read all rows from your Google Sheet.
- **Upsert** each account into the `accounts` table (safe to re-run — uses `ON CONFLICT DO UPDATE`).
- Print a summary of inserted / updated / errored rows.

```
✅ Connected.
✅ Schema ready.
📊 Reading accounts from Google Sheets...
✅ Found 20 accounts in Sheets.

  ✅ Inserted:  account1@gmail.com
  🔄 Updated:   account2@gmail.com
  ...

─────────────────────────────────
Migration complete:
  ✅ Inserted: 18
  🔄 Updated:  2
  ❌ Errors:   0
  Total:       20
─────────────────────────────────
```

### 4. Verify in Drizzle Studio

```bash
bun db:studio
```

Open the provided URL to confirm all accounts landed correctly in the `accounts` table.

---

## 🏃‍♂️ Running the Dashboard

```bash
bun dev
```

Navigate to [http://localhost:3000](http://localhost:3000) to access the automation dashboard.

From the dashboard you can:
- View all accounts and their latest credit status.
- **Check one** account individually, or hit **Bulk Check** to process all accounts in parallel.
- Use the **Pending** shortcut to bulk-check only accounts marked as `pending`.
- Click any account row to open its **Check History**, showing a full audit log with per-member credit breakdowns (member email, name, credit per row).

---

## ⌨️ Standalone CLI Scripts

### Credit Checker (`checkOne.ts`)

Runs a single-account headless credit check. Automatically fetches the Google Family roster and maps member credits to emails.

```bash
bun checkOne.ts '{"email":"your@email.com","password":"your_password","totpSecret":"YOUR_BASE32_SECRET"}'
```

### 2FA Setup (`change2fa.ts`)

Automates navigating to Google Account security settings to set up or rotate a Google Authenticator 2FA secret.

```bash
bun change2fa.ts '{"email":"your@email.com","password":"your_password","totpSecret":"CURRENT_SECRET"}'
```

*(Outputs the new Base32 TOTP secret on success.)*

---

## 📊 Useful Log Commands

```bash
# Stream live logs with pretty formatting
bun logs:tail

# View all logs
bun logs

# View only errors
bun logs:errors
```

Logs are written to `logs/app.log` and streamed live to the dashboard UI via SSE.

---

## 🧰 Internal Architecture

| File | Purpose |
|---|---|
| `src/lib/db.ts` | All database access (Drizzle ORM + raw SQL for analytics) |
| `src/lib/schema.ts` | TypeScript type definitions for DB rows & JSONB fields |
| `src/lib/gpm-profile-pool.ts` | GPM browser profile pool — semaphore-locked session caching |
| `checkOne.ts` | Standalone credit check orchestrator (Playwright login → CDP scrape → family enrichment) |
| `checkFamily.ts` | Playwright module to fetch Google Family member roster (name, email, role) |
| `google-auth.ts` | Shared auth primitives: TOTP, passkey dismissal, webdriver bypass |
| `src/app/api/check/route.ts` | Single-account check API endpoint |
| `src/app/api/bulk-check/route.ts` | Parallel bulk-check endpoint with concurrency control |
| `scripts/migrate-from-sheets.ts` | One-time Google Sheets → PostgreSQL migration script |

---

## 🐛 Troubleshooting

| Problem | Solution |
|---|---|
| `DATABASE_URL is not set` | Add `DATABASE_URL` to `.env.local` and restart the server. |
| `Cannot connect to PostgreSQL` | Run `docker-compose up -d postgres` and wait a few seconds. |
| Playwright fails to launch | Run `npx playwright install chromium` to install browser binaries. |
| 2FA challenge fails | Verify the `totpSecret` is the correct Base32 string (no spaces). |
| Member emails missing | The account may not have run a check since the enrichment update — re-run a check to populate. |
| Screenshots not saving | Ensure the `tmp_screenshots/` directory exists and is writable. |
