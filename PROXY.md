# Proxy Architecture

Each Chrome slot in the bulk-check pool routes all traffic through a dedicated Oxylabs ISP proxy connection. This prevents Google from linking sessions across accounts and avoids bot detection triggered by shared or non-residential IPs.

## How It Works

```
bulk-check API
     │
     ▼
chrome-pool.ts (ensureChrome)
     │
     ├─ spawns run-proxy.js  ──► local proxy-chain server  ──► Oxylabs upstream  ──► Google
     │      127.0.0.1:1800X                                       isp.oxylabs.io:800X
     │
     └─ launches Chrome
            --proxy-server=http://127.0.0.1:1800X
```

### Step-by-step

1. `ensureChrome(port)` is called for a slot (e.g. port `9300`).
2. It computes:
   - `portIndex = port - BASE_PORT` → e.g. `0`
   - `upstreamPort = 8001 + (portIndex % 99)` → e.g. `8001`
   - `localPort = 10000 + upstreamPort` → e.g. `18001`
3. It spawns `run-proxy.js` as a **detached, unref'd** Node process listening on `127.0.0.1:18001`.
4. `run-proxy.js` uses `proxy-chain` to forward all traffic → `http://USER:PASS@isp.oxylabs.io:8001`.
5. After a 1 s startup delay, Chrome is launched with `--proxy-server=http://127.0.0.1:18001`.
6. Chrome polls every 500 ms (up to 15 s) for the CDP endpoint to come up.

## Port Mapping (default config)

| Slot | Chrome CDP port | Local proxy port | Oxylabs upstream port |
|------|----------------|------------------|-----------------------|
| 0    | 9300           | 18001            | 8001                  |
| 1    | 9301           | 18002            | 8002                  |
| 2    | 9302           | 18003            | 8003                  |
| …    | …              | …                | …                     |
| N    | 9300+N         | 18001+N          | 8001+(N%99)           |

## Files

| File | Role |
|------|------|
| `src/lib/chrome-pool.ts` | Manages Chrome slots; computes ports and spawns the proxy helper before launching Chrome |
| `src/lib/run-proxy.js` | Lightweight Node process — starts a `proxy-chain` HTTP proxy server that adds Oxylabs auth and forwards upstream |

## Environment Variables

All variables are read from `.env.local` and **must be set** for proxies to work.

| Variable | Default | Description |
|---|---|---|
| `OXYLABS_PROXY_HOST` | `isp.oxylabs.io` | Oxylabs ISP proxy hostname |
| `OXYLABS_PROXY_USER` | *(none)* | Oxylabs username |
| `OXYLABS_PROXY_PASS` | *(none)* | Oxylabs password |
| `BULK_CONCURRENCY` | `10` | Number of Chrome slots (= number of simultaneous proxy connections) |
| `BULK_BASE_PORT` | `9300` | First Chrome CDP port |
| `BULK_PROFILE_DIR` | `/tmp/ggchecks-profiles` | Root dir for Chrome persistent profiles |

> **Important:** `run-proxy.js` is spawned as a detached child process and does **not** inherit the Next.js process environment automatically. `chrome-pool.ts` explicitly passes `OXYLABS_*` vars via the `env` option on `spawn()`. If you add new env vars for the proxy, make sure to forward them there too.

## Why `proxy-chain` instead of passing auth directly to Chrome?

Chrome's `--proxy-server` flag does not support embedded credentials (`http://user:pass@host`). `proxy-chain` acts as a local unauthenticated relay that injects the upstream credentials on each request, making the auth transparent to Chrome.

## Lifecycle

- **Proxy processes outlive the Next.js request.** They are spawned with `detached: true` + `unref()`, so they keep running even if the API route finishes or the server restarts.
- **Chrome instances also outlive the request** for the same reason — persistent profiles cache Google session cookies across checks.
- There is currently **no cleanup routine**. On server restart, orphaned proxy and Chrome processes remain. Use `pkill -f run-proxy.js` and `pkill -f "remote-debugging-port"` to clean up manually if needed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Chrome starts but all requests fail / `ERR_PROXY_CONNECTION_FAILED` | Oxylabs credentials missing or wrong | Check `OXYLABS_PROXY_USER` / `OXYLABS_PROXY_PASS` in `.env.local` |
| `Chrome on port X did not start within 15 s` | proxy-chain failed to bind before Chrome launched | Increase the 1 s startup delay in `chrome-pool.ts` or check for port conflicts |
| IP not rotating between slots | All slots landing on same upstream port | Verify `portIndex` math and that Oxylabs account supports multiple ports |
| Proxy process not receiving env vars | Spawning without explicit `env` | `chrome-pool.ts` must pass `env: { ...process.env, OXYLABS_* }` to `spawn()` |
