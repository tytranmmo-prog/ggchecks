# GG Checks — Google Family AI Credit Activity Checker

Automates checking Google One AI credit activity and family group member spending across multiple accounts.

## Setup

```bash
npm install
```

## Configure Accounts

Edit `accounts.json`:

```json
[
  {
    "email": "account@gmail.com",
    "password": "your-password",
    "totpSecret": "YOUR_TOTP_BASE32_SECRET"
  },
  {
    "email": "account2@gmail.com",
    "password": "another-password",
    "totpSecret": "ANOTHER_TOTP_SECRET"
  }
]
```

> `totpSecret` is the base32 secret from Google Authenticator / 2FA setup.

## Run

```bash
node checker.js
# or with custom accounts file:
node checker.js /path/to/accounts.json
```

## Output

Results are printed to console and saved to `results.json`:

```json
[
  {
    "account": "tya@gmail.com",
    "checkAt": "2026-03-27T00:00:00.000Z",
    "monthlyCredits": "24,950",
    "additionalCredits": "100",
    "additionalCreditsExpiry": "Apr 25, 2026",
    "ownActivity": [],
    "memberActivities": [
      { "name": "Nguyen Vg", "credit": -50, "checkAt": "2026-03-27T00:00:00.000Z" }
    ]
  }
]
```

## Proxy

Uses Oxylabs ISP proxy by default. Configured in `checker.js`:

```
Host: isp.oxylabs.io
Port: 8001-8099 (random per run)
User: proxyvip_VV7Fk
Pass: Lungtung1_23
```

## Error Handling

On errors, a screenshot is saved as `error_<account>_<timestamp>.png` for debugging.
