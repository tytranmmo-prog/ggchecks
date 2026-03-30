/**
 * logger.ts — Logger Interface & Types
 *
 * Defines the canonical logging contract for the application.
 * Every logger implementation (Pino, mock, etc.) must satisfy ILogger.
 *
 * Design:
 *   - Feature-scoped: each module calls createLogger('feature-name')
 *   - Context-propagating: child() binds extra fields (email, runId, …)
 *     to every subsequent log call — crucial for tracing one account
 *     across multiple features (bulk-check → gpm-pool → sheets)
 *   - Structured: all context is key-value, not string-interpolated,
 *     making it filterable at the /api/logs endpoint
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *
 *   const log = createLogger('bulk-check');
 *   log.info('request received', { accountCount: 50 });
 *
 *   const alog = log.child({ email, runId });
 *   alog.info('waiting for pool slot');
 *   alog.error('checker failed', { exitCode: 1, stderr });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Severity levels, ordered lowest → highest. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Arbitrary key-value pairs attached to a log entry.
 * All values must be JSON-serializable.
 */
export type LogContext = Record<string, unknown>;

/**
 * A single normalized log entry stored in the ring buffer
 * and returned by the /api/logs endpoint.
 */
export interface LogEntry {
  /** ISO-8601 timestamp. */
  ts: string;
  /** Severity level. */
  level: LogLevel;
  /** The module that emitted this entry (e.g. 'bulk-check', 'gpm-pool'). */
  feature: string;
  /** Human-readable message. */
  msg: string;
  /**
   * Structured context bound at log-site or via child().
   * Examples: { email, runId, port, profileId, exitCode }
   */
  context: LogContext;
}

/** Filter parameters accepted by LogStore.getEntries(). */
export interface LogFilter {
  /** Only entries from this feature. */
  feature?: string;
  /** Minimum severity level (inclusive). */
  level?: LogLevel;
  /** Only entries whose context.email contains this string. */
  email?: string;
  /** Only entries whose context.runId equals this string. */
  runId?: string;
  /** Only entries at or after this ISO timestamp. */
  since?: string;
  /** Maximum number of entries to return (default 500). */
  limit?: number;
}

// ─── ILogger interface ────────────────────────────────────────────────────────

/**
 * Core logging contract.
 *
 * Implementations: PinoLogger (src/lib/pino-logger.ts)
 */
export interface ILogger {
  /** The feature tag this instance was created with. */
  readonly feature: string;

  /** Log a debug-level message (verbose, development noise). */
  debug(msg: string, context?: LogContext): void;

  /** Log an informational message (normal operation milestones). */
  info(msg: string, context?: LogContext): void;

  /** Log a warning (recoverable issue, degraded behaviour). */
  warn(msg: string, context?: LogContext): void;

  /** Log an error (operation failed, requires attention). */
  error(msg: string, context?: LogContext): void;

  /**
   * Returns a new ILogger that merges `context` into every subsequent
   * log call — without modifying this logger.
   *
   * Use this to bind per-request, per-account, or per-run fields so
   * every log line from that scope is automatically annotated:
   *
   *   const alog = log.child({ email, runId });
   *   alog.info('slot acquired');   // → { feature, email, runId, msg }
   *   alog.error('checker failed'); // → { feature, email, runId, msg }
   */
  child(context: LogContext): ILogger;
}

// ─── LogStore interface ───────────────────────────────────────────────────────

/**
 * In-memory store that holds recent log entries.
 * Implemented as a ring buffer — oldest entries are evicted once capacity is hit.
 *
 * This is the backing store for the /api/logs query endpoint.
 */
export interface LogStore {
  /** Number of entries currently in the buffer. */
  readonly size: number;

  /**
   * Returns entries matching all provided filters.
   * Results are ordered oldest → newest.
   */
  getEntries(filter?: LogFilter): LogEntry[];

  /** Clears all entries from the buffer. */
  clear(): void;
}

// ─── Factory (re-exported by the concrete implementation) ────────────────────

/**
 * Creates a feature-scoped ILogger.
 * Concrete implementations re-export this under the same name so callers
 * never import from the implementation file directly.
 *
 *   import { createLogger } from '@/lib/logger';
 *
 * The actual factory is provided by pino-logger.ts which re-exports it
 * as the default createLogger for the application.
 */
export type LoggerFactory = (feature: string) => ILogger;
