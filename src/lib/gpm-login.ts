/**
 * GPMLogin Global Local API — TypeScript models & client
 *
 * GPMLogin Global is a **browser profile manager** for Chromium and Firefox.
 * Each «profile» is an isolated browser identity with its own fingerprint,
 * proxy, cookies, and settings. You can open and close real browser windows
 * by calling the `start` / `stop` profile endpoints.
 *
 * Base URL: http://{{Local URL}}/api/v1
 * Default:  http://127.0.0.1:19995/api/v1
 *
 * All endpoints return a standard ApiResponse<T> envelope:
 *   { success: boolean, data: T | null, message: string, sender: string }
 *
 * Docs: https://github.com/GPMSoft/GPMLoginGlobalApiDocs
 */

// ---------------------------------------------------------------------------
// Generic response wrappers
// ---------------------------------------------------------------------------

/** Standard envelope returned by every API endpoint. */
export interface ApiResponse<T> {
  /** Whether the request succeeded. */
  success: boolean;
  /** The response payload; `null` on failure. */
  data: T | null;
  /** Human-readable status message, e.g. `"OK"`. */
  message: string;
  /** Server identifier, e.g. `"GPMLoginGlobal v1.0.0"`. */
  sender: string;
}

/** Wraps a paginated list of items returned by list endpoints. */
export interface PagedData<T> {
  /** Current page number (1-based). */
  current_page: number;
  /** Items per page. */
  per_page: number;
  /** Total number of items across all pages. */
  total: number;
  /** Index of the last page. */
  last_page: number;
  /** Items on the current page. */
  data: T[];
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** A profile group. */
export interface Group {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Sort order in the UI. */
  order: number;
}

/** Request body for creating or updating a group. */
export interface GroupRequest {
  /** Display name. Required. */
  name: string;
  /** Sort order. Optional. */
  order?: number;
}

// ---------------------------------------------------------------------------
// Proxies
// ---------------------------------------------------------------------------

/** A label associated with a proxy. */
export interface ProxyTag {
  /** Unique identifier. */
  id: string;
  /** Tag label. */
  name: string;
}

/** A proxy entry. */
export interface Proxy {
  /** Unique identifier. */
  id: string;
  /** Connection string, e.g. `http://user:pass@host:port`. */
  raw_proxy: string;
  /** Labels associated with this proxy. */
  tags: ProxyTag[];
}

/** Query parameters for listing proxies. */
export interface ListProxiesParams {
  page?: number;
  page_size?: number;
  /** Search/filter term. */
  search?: string;
  /** Sort field. */
  sort?: string;
}

/** Request body for creating a proxy. */
export interface CreateProxyRequest {
  /** Connection string. Required. */
  raw_proxy: string;
  /** Optional display name. */
  name?: string;
  /** Whether to validate the proxy after creation. */
  check_proxy_after_create?: boolean;
}

/** Request body for updating a proxy. */
export interface UpdateProxyRequest {
  /** New connection string. */
  raw_proxy?: string;
  /** New display name. */
  name?: string;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** A browser profile. */
export interface Profile {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Assigned group identifier, or `null`. */
  group_id: string | null;
  /** Proxy connection string, or `null`. */
  raw_proxy: string | null;
  /**
   * Browser type identifier.
   * Consult GPMLogin documentation for the list of valid values.
   */
  browser_type: number;
  /** Pinned browser version string, e.g. `"120.0.6099.109"`. */
  browser_version: string;
  /** Operating system type identifier. */
  os_type: number;
  /** Custom User-Agent string, or `null` to use the auto-generated one. */
  custom_user_agent: string | null;
  /** Custom browser task-bar title, or `null`. */
  task_bar_title: string | null;
  /** WebRTC leak prevention mode. */
  webrtc_mode: number | null;
  /** Fixed public IP reported via WebRTC when the mode requires it. */
  fixed_webrtc_public_ip: string;
  /** Geolocation spoofing mode. */
  geolocation_mode: number | null;
  /** Canvas fingerprint protection mode. */
  canvas_mode: number | null;
  /** ClientRects fingerprint protection mode. */
  client_rect_mode: number | null;
  /** WebGL image fingerprint protection mode. */
  webgl_image_mode: number | null;
  /** WebGL metadata fingerprint protection mode. */
  webgl_metadata_mode: number | null;
  /** Audio fingerprint protection mode. */
  audio_mode: number | null;
  /** Font enumeration fingerprint protection mode. */
  font_mode: number | null;
  /** Whether the timezone is derived from the proxy IP address. */
  timezone_base_on_ip: boolean;
  /** Fixed timezone string (e.g. `"America/New_York"`) when `timezone_base_on_ip` is `false`. */
  timezone: string | null;
  /** Whether the browser language is derived from the proxy IP address. */
  is_language_base_on_ip: boolean;
  /** Fixed language tag (e.g. `"en-US"`) when `is_language_base_on_ip` is `false`. */
  fixed_language: string | null;
}

/** Request body for creating or updating a profile. */
export interface ProfileRequest {
  /** Display name. Required. */
  name: string;
  /** ID of the group to assign the profile to. */
  group_id?: string;
  /**
   * Raw proxy string. Supported formats:
   * - `http://user:pass@host:port`
   * - `socks5://host:port`
   */
  raw_proxy?: string;
  /** Browser type identifier. */
  browser_type?: number;
  /** Pinned browser version string, e.g. `"120.0.6099.109"`. */
  browser_version?: string;
  /** Operating system type identifier. */
  os_type?: number;
  /** Custom User-Agent string; omit to auto-generate. */
  custom_user_agent?: string;
  /** Custom browser task-bar title. */
  task_bar_title?: string;
  /** WebRTC leak prevention mode. */
  webrtc_mode?: number;
  /** Fixed public IP to report via WebRTC when the mode requires it. */
  fixed_webrtc_public_ip?: string;
  /** Geolocation spoofing mode. */
  geolocation_mode?: number;
  /** Canvas fingerprint protection mode. */
  canvas_mode?: number;
  /** ClientRects fingerprint protection mode. */
  client_rect_mode?: number;
  /** WebGL image fingerprint protection mode. */
  webgl_image_mode?: number;
  /** WebGL metadata fingerprint protection mode. */
  webgl_metadata_mode?: number;
  /** Audio fingerprint protection mode. */
  audio_mode?: number;
  /** Font enumeration fingerprint protection mode. */
  font_mode?: number;
  /** When `true`, the timezone is derived from the proxy IP. Default: `true`. */
  timezone_base_on_ip?: boolean;
  /** Fixed timezone string used when `timezone_base_on_ip` is `false`. */
  timezone?: string;
  /** When `true`, the browser language is derived from the proxy IP. Default: `true`. */
  is_language_base_on_ip?: boolean;
  /** Fixed language tag used when `is_language_base_on_ip` is `false`. */
  fixed_language?: string;
}

/** Query parameters for listing profiles. */
export interface ListProfilesParams {
  page?: number;
  page_size?: number;
  /** Search/filter term. */
  search?: string;
  /** Filter by group ID. */
  group_id?: string;
}

/** Extra runtime details included in the start-profile response. */
export interface StartProfileAdditionInfo {
  /** OS process ID of the launched browser process. */
  process_id: number;
  /** Display name of the started profile. */
  profile_name: string;
  /** Native window handle (Windows HWND). Only relevant on Windows. */
  window_handle: number;
}

/**
 * Optional query parameters for the start-profile endpoint.
 *
 * `GET /api/v1/profiles/start/{id}`
 */
export interface StartProfileOptions {
  /**
   * CDP remote debugging port to bind.
   * `0` (default) = GPMLogin auto-selects a free port.
   */
  remote_debugging_port?: number;
  /**
   * Window scale factor (e.g. `0.8` = 80%).
   * Default: `1` (100%).
   */
  window_scale?: number;
  /**
   * Window position as `"x,y"` (e.g. `"100,100"`).
   * Omit to let the OS decide.
   */
  window_pos?: string;
  /**
   * Window size as `"width,height"` (e.g. `"800,600"`).
   * Omit to use the profile's saved size.
   */
  window_size?: string;
  /**
   * Additional CLI arguments passed directly to the browser process.
   * Default: `""` (none).
   */
  addition_args?: string;
}

/**
 * Data returned after a profile browser is successfully opened.
 *
 * Use `remote_debugging_port` to attach Puppeteer/Playwright via CDP:
 * ```ts
 * const browser = await puppeteer.connect({
 *   browserURL: `http://127.0.0.1:${result.remote_debugging_port}`,
 * });
 * ```
 */
export interface StartProfileResult {
  /** ID of the profile whose browser was launched. */
  profile_id: string;
  /** Absolute path to the matching ChromeDriver binary (for Selenium). */
  driver_path: string;
  /**
   * Chrome DevTools Protocol (CDP) port.
   * Connect Puppeteer, Playwright, or any CDP client to this port.
   */
  remote_debugging_port: number;
  /** Extra runtime details (PID, window handle, etc.). */
  addition_info: StartProfileAdditionInfo | null;
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/** A browser extension managed by GPMLogin Global. */
export interface Extension {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Whether the extension is currently enabled. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Browser Versions
// ---------------------------------------------------------------------------

/**
 * Available browser versions installed in GPMLogin Global.
 *
 * `GET /api/v1/browsers/versions`
 */
export interface BrowserVersionsData {
  /** List of available Chromium version strings, newest first. */
  chromium: string[];
  /** List of available Firefox version strings, newest first. */
  firefox: string[];
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

/**
 * Lightweight HTTP client for the GPMLogin Global Local API.
 *
 * @example
 * const gpm = new GpmLoginClient('http://127.0.0.1:19995');
 * const groups = await gpm.groups.list();
 */
export class GpmLoginClient {
  private readonly base: string;

  constructor(localUrl = 'http://127.0.0.1:19995') {
    this.base = `${localUrl.replace(/\/$/, '')}/api/v1`;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<ApiResponse<T>> {
    let url = `${this.base}${path}`;

    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`GPMLogin API error ${res.status}: ${await res.text()}`);
    }

    return res.json() as Promise<ApiResponse<T>>;
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  readonly groups = {
    /** List all groups. */
    list: () =>
      this.request<Group[]>('GET', '/groups'),

    /** Get a group by ID. */
    get: (id: string) =>
      this.request<Group>('GET', `/groups/${id}`),

    /** Create a new group. */
    create: (body: GroupRequest) =>
      this.request<Group>('POST', '/groups/create', body),

    /** Update an existing group. */
    update: (id: string, body: GroupRequest) =>
      this.request<Group>('POST', `/groups/update/${id}`, body),

    /** Delete a group by ID. */
    delete: (id: string) =>
      this.request<null>('GET', `/groups/delete/${id}`),
  };

  // ── Proxies ───────────────────────────────────────────────────────────────

  readonly proxies = {
    /** List proxies (paginated). */
    list: (params?: ListProxiesParams) =>
      this.request<PagedData<Proxy>>('GET', '/proxies', undefined, params as Record<string, string | number | boolean | undefined>),

    /** Get a proxy by ID. */
    get: (id: string) =>
      this.request<Proxy>('GET', `/proxies/${id}`),

    /** Create a new proxy. */
    create: (body: CreateProxyRequest) =>
      this.request<Proxy>('POST', '/proxies/create', body),

    /** Update a proxy. */
    update: (id: string, body: UpdateProxyRequest) =>
      this.request<Proxy>('POST', `/proxies/update/${id}`, body),

    /** Delete a proxy by ID. */
    delete: (id: string) =>
      this.request<null>('GET', `/proxies/delete/${id}`),
  };

  // ── Profiles ──────────────────────────────────────────────────────────────

  readonly profiles = {
    /** List profiles (paginated). */
    list: (params?: ListProfilesParams) =>
      this.request<PagedData<Profile>>('GET', '/profiles', undefined, params as Record<string, string | number | boolean | undefined>),

    /** Get a profile by ID. */
    get: (id: string) =>
      this.request<Profile>('GET', `/profiles/${id}`),

    /** Create a new profile. */
    create: (body: ProfileRequest) =>
      this.request<Profile>('POST', '/profiles/create', body),

    /** Update an existing profile. */
    update: (id: string, body: Partial<ProfileRequest>) =>
      this.request<Profile>('POST', `/profiles/update/${id}`, body),

    /** Delete a profile by ID. */
    delete: (id: string) =>
      this.request<null>('GET', `/profiles/delete/${id}`),

    /**
     * Open a browser window for this profile.
     *
     * GPMLogin launches a real Chromium/Firefox process tied to the profile's
     * stored fingerprint, proxy, and cookies. The response includes the CDP
     * port you can use to attach Puppeteer or Playwright.
     *
     * All options are optional. Pass `remote_debugging_port: 0` (or omit it)
     * to let GPMLogin auto-select a free port.
     *
     * @example
     * const res = await gpm.profiles.start(id, { window_size: '1280,800' });
     * // res.data.remote_debugging_port → CDP port
     */
    start: (id: string, options?: StartProfileOptions) =>
      this.request<StartProfileResult>('GET', `/profiles/start/${id}`, undefined,
        options as Record<string, string | number | boolean | undefined>),

    /**
     * Close the browser window for this profile.
     *
     * Terminates the browser process GPMLogin launched via `start`.
     * Profile data (cookies, local storage) is preserved.
     */
    stop: (id: string) =>
      this.request<null>('GET', `/profiles/stop/${id}`),
  };

  // ── Extensions ────────────────────────────────────────────────────────────

  readonly extensions = {
    /** List all available extensions. */
    list: () =>
      this.request<Extension[]>('GET', '/extensions'),

    /**
     * Enable or disable an extension.
     * @param active `true` to enable, `false` to disable.
     */
    updateState: (id: string, active: boolean) =>
      this.request<null>('GET', `/extensions/update-state/${id}`, undefined, { active }),
  };

  // ── Browsers ──────────────────────────────────────────────────────────────

  readonly browsers = {
    /**
     * List all browser versions installed in GPMLogin Global.
     *
     * Returns Chromium and Firefox version strings, newest first.
     * Use `res.data.chromium[0]` to get the latest Chromium version.
     *
     * @example
     * const res = await gpm.browsers.versions();
     * const latest = res.data?.chromium[0]; // e.g. "144.0.7559.110"
     */
    versions: () =>
      this.request<BrowserVersionsData>('GET', '/browsers/versions'),
  };
}
