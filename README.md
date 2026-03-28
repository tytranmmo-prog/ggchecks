# GG Checks — Google Account Automation Dashboard

A powerful, stealthy full-stack Next.js application built to manage, automate, and monitor Google One AI credits across multiple Google family accounts. Instead of managing credits linearly, GG Checks integrates directly with Google Sheets to bulk-process accounts, handle mandatory 2FA TOTP logins, bypass bot detections via Chrome DevTools Protocol (CDP) and Proxies, and visually report failures.

## 🚀 Core Capabilities

1. **Dashboard Interface**
   - Clean, dark-mode Next.js UI reading directly from Google Sheets.
   - Real-time SSE (Server-Sent Events) terminal logs streamed directly to the frontend.
2. **Stealth Operation (CDP Pool)**
   - Uses Playwright purely for isolated session logins.
   - Automatically disconnects Playwright post-login and uses raw WebSocket CDP commands to bypass stringent Google `navigator.webdriver` bot detection during scraping.
   - Manages a persistent Chrome Profile pool, caching sessions (bound to emails) to avoid repetitive multi-step logins.
3. **Automated Google 2FA Bypass**
   - Automatically resolves interstitial 2FA menus and inputs 6-digit TOTP codes derived from your synced Base32 Authenticator secrets.
4. **Google Drive & Sheets Integration**
   - Captures failure screenshots securely during scraping and auto-uploads them to Google Drive.
   - Auto-embeds the screenshot directly within the target Google Sheet using `=IMAGE("...")` for an instantly auditable dashboard.
5. **Proxy Support**
   - Built-in rotating ISP proxy routing using `proxy-chain` integrated with Oxylabs, preventing your local machine's IP from being flagged.

## 🛠 Prerequisites & Installation

- **Environment**: Node.js & [Bun](https://bun.sh/)
- **Browser**: Google Chrome must be installed locally, and Playwright needs its browser binaries.

```bash
# Install Node dependencies using Bun
bun install

# Install Playwright Chromium binaries (Required for the automation engine)
npx playwright install chromium
```

## ⚙️ Configuration

Copy your credentials into `.env.local` to securely hook up the Google APIs and proxy layer:

```env
# Google Service Account (with Sheets + Drive API scopes turned on)
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# The Google Sheet ID to use as the Database
GOOGLE_SHEET_ID="your-sheet-id"

# Proxy configuration (Oxylabs by default, dynamically rotating ports)
PROXY_USERNAME="proxy_user_123"
PROXY_PASSWORD="proxy_password"

# Optional: ID of the Google Drive folder to upload error screenshots to
# If empty, uploads to root folder of the Service Account
DRIVE_SCREENSHOT_FOLDER_ID="your-folder-id"
```

### Google Sheet Format

Your connected Google Sheet must have the following exact headers (case-sensitive) on the first row:
*   `email`
*   `password`
*   `totpSecret`

The application will automatically scaffold the remaining programmatic columns (`status`, `monthlyCredits`, `screenshot`, etc.) when the integration runs.

## 🏃‍♂️ Running the Dashboard

Start the local Next.js development server:

```bash
bun dev
```

Navigate to [http://localhost:3000](http://localhost:3000) to access the automation dashboard! You can select rows and manually check one profile at a time, or hit Bulk Run for massive, parallelized concurrency.

## ⌨️ Standalone CLI Scripts

Beyond the dashboard, you can run the core automation scripts directly from your terminal.

### Credit Checker (`checkOne.ts`)
Runs a completely headless, single-account scrape of the Google One AI activity page. To test it manually:

```bash
bun checkOne.ts '{"email":"your@email.com","password":"your_password","totpSecret":"YOUR_BASE32_SECRET","debugPort":9222}'
```
*(Note: You must have a Chrome instance running with a matching `--remote-debugging-port=9222` to connect to it via CDP)*

### 2FA Authenticator Setup (`change2fa.ts`)
A dedicated script to automate navigating to a Google Account's security settings and setting up/rotating a brand new Google Authenticator 2FA secret. 

```bash
bun change2fa.ts '{"email":"your@email.com","password":"your_password","totpSecret":"CURRENT_OR_EMPTY_SECRET"}'
```
*(This script will output the new generated Base32 TOTP secret upon success).*

## 🧰 Internal Architecture Notes

- `src/lib/chrome-profile-pool.ts`: The strict semaphore-locking pool engine handling ephemeral & persistent profile initialization and multiplexing Chrome WS connections.
- `checkOne.ts`: A purely headless, standalone Node process that runs the scraping extraction via CDP and generates local error screenshots.
- `google-auth.ts`: Shared Google utility primitives resolving password fields, passing Totp Challenges, and dismissing persistent Passkey upsells.
- `src/app/api/bulk-check/route.ts`: API endpoint accepting the bulk checking mechanism and handling Drive integration fallback routines.

## 🐛 Troubleshooting & Error Screenshots

When an account encounters an unexpected DOM change or Google blocks the login entirely, GG Checks will attempt to snap a visual screenshot evidence log.
1. The screenshot is saved locally to `/tmp/ggchecks-screenshots/`.
2. It is cleanly uploaded to your connected Google Drive path via secure stream (`src/lib/sheets.ts`).
3. An `=IMAGE()` formula is injected into your Sheet tying the failure straight to the database row for immediately auditable inspection!
