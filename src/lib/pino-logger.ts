/**
 * pino-logger.ts — Pino implementation of ILogger
 *
 * Architecture:
 *   Root Pino instance → pino.multistream([fileStream, ringStream])
 *                                            │               │
 *                                     logs/app.log    RingBuffer (in-memory)
 *
 * - fileStream  : persistent JSON-lines file, survives server restarts
 * - ringStream  : in-memory circular buffer (2000 entries), feeds /api/logs
 *
 * Both destinations receive every log entry, so you can:
 *   • Query live state via GET /api/logs
 *   • Grep the file for historical data: grep '"email":"x@y.com"' logs/app.log | jq .
 *
 * Public API (re-exported for app-wide use):
 *   createLogger(feature)   → ILogger scoped to that feature
 *   logStore                → LogStore — used by /api/logs route
 */

import pino from 'pino';
import { Writable } from 'stream';
import { mkdirSync } from 'fs';
import path from 'path';
import type { ILogger, LogContext, LogEntry, LogFilter, LogLevel, LogStore } from './logger';

// ─── Level mapping ────────────────────────────────────────────────────────────

/** Pino numeric level → our LogLevel string */
const PINO_LEVEL_MAP: Record<number, LogLevel> = {
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

// ─── RingBuffer (LogStore) ────────────────────────────────────────────────────

class RingBuffer implements LogStore {
  private readonly buf: LogEntry[] = [];
  private readonly capacity: number;

  constructor(capacity = 2000) {
    this.capacity = capacity;
  }

  push(entry: LogEntry): void {
    if (this.buf.length >= this.capacity) {
      this.buf.shift(); // evict oldest
    }
    this.buf.push(entry);
  }

  get size(): number {
    return this.buf.length;
  }

  getEntries(filter?: LogFilter): LogEntry[] {
    let results = [...this.buf];

    if (filter?.feature) {
      results = results.filter(e => e.feature === filter.feature);
    }

    if (filter?.level) {
      const minRank = LEVEL_RANK[filter.level];
      results = results.filter(e => LEVEL_RANK[e.level] >= minRank);
    }

    if (filter?.email) {
      const emailLower = filter.email.toLowerCase();
      results = results.filter(e =>
        String(e.context.email ?? '').toLowerCase().includes(emailLower),
      );
    }

    if (filter?.runId) {
      results = results.filter(e => e.context.runId === filter.runId);
    }

    if (filter?.since) {
      const sinceMs = new Date(filter.since).getTime();
      results = results.filter(e => new Date(e.ts).getTime() >= sinceMs);
    }

    const limit = filter?.limit ?? 500;
    // Return latest N entries
    return results.slice(-limit);
  }

  clear(): void {
    this.buf.length = 0;
  }
}

/** Singleton store — imported by /api/logs route. */
export const logStore: LogStore & { push: (e: LogEntry) => void } =
  new RingBuffer();

// ─── Ring writable stream ─────────────────────────────────────────────────────

/**
 * A Node.js Writable that parses each JSON-lines chunk from Pino
 * and pushes normalized LogEntry objects into the ring buffer.
 */
function createRingStream(): Writable {
  let leftover = '';

  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const text = leftover + chunk.toString();
      const lines = text.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const record = JSON.parse(trimmed) as Record<string, unknown>;
          const level: LogLevel = PINO_LEVEL_MAP[record.level as number] ?? 'info';

          // Destructure known pino fields out; the rest becomes `context`
          const {
            time: _time,
            level: _level,
            pid: _pid,
            hostname: _hostname,
            feature,
            msg,
            ...context
          } = record;

          (logStore as RingBuffer).push({
            ts:      new Date(record.time as number).toISOString(),
            level,
            feature: String(feature ?? 'unknown'),
            msg:     String(msg ?? ''),
            context: context as LogContext,
          });
        } catch {
          // Malformed line — skip silently
        }
      }

      cb();
    },
  });
}

// ─── Root Pino instance ───────────────────────────────────────────────────────

function buildRootPino(): pino.Logger {
  const logDir = path.join(process.cwd(), 'logs');
  mkdirSync(logDir, { recursive: true });

  const fileStream = pino.destination({
    dest:  path.join(logDir, 'app.log'),
    sync:  false, // async writes — no I/O blocking
  });

  const ringStream = createRingStream();

  return pino(
    {
      level:     'debug',      // capture everything; filter at query time
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream([
      { stream: fileStream, level: 'debug' },
      { stream: ringStream, level: 'debug' },
    ]),
  );
}

// Lazy singleton — only built when first logger is created (server-side only)
let _root: pino.Logger | undefined;

function getRoot(): pino.Logger {
  if (!_root) _root = buildRootPino();
  return _root;
}

// ─── PinoLogger — implements ILogger ─────────────────────────────────────────

export class PinoLogger implements ILogger {
  readonly feature: string;
  private readonly _pino: pino.Logger;

  /**
   * @param feature      Feature tag for this logger (e.g. 'bulk-check')
   * @param pinoInstance Internal: pass a child pino instance from child()
   */
  constructor(feature: string, pinoInstance?: pino.Logger) {
    this.feature = feature;
    // If no instance supplied, create a feature-bound child of the root
    this._pino = pinoInstance ?? getRoot().child({ feature });
  }

  debug(msg: string, ctx?: LogContext): void {
    this._pino.debug(ctx ?? {}, msg);
  }

  info(msg: string, ctx?: LogContext): void {
    this._pino.info(ctx ?? {}, msg);
  }

  warn(msg: string, ctx?: LogContext): void {
    this._pino.warn(ctx ?? {}, msg);
  }

  error(msg: string, ctx?: LogContext): void {
    this._pino.error(ctx ?? {}, msg);
  }

  /**
   * Returns a new PinoLogger that binds `context` to every log call.
   * The feature tag is preserved from the parent.
   *
   * Example:
   *   const alog = log.child({ email, runId });
   *   alog.info('pool slot acquired');
   *   // → { feature: 'bulk-check', email: 'x@y.com', runId: 'abc', msg: '...' }
   */
  child(context: LogContext): ILogger {
    return new PinoLogger(this.feature, this._pino.child(context));
  }
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * Creates a feature-scoped ILogger backed by Pino.
 *
 * Call once per module, at module level:
 *   const log = createLogger('bulk-check');
 *
 * Then bind per-request context with child():
 *   const alog = log.child({ email, runId });
 */
export function createLogger(feature: string): ILogger {
  return new PinoLogger(feature);
}
