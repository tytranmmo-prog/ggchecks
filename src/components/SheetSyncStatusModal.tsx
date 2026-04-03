'use client';

import { useState, useRef, useEffect } from 'react';

// ── SSE event shapes ──────────────────────────────────────────────────────────

type EventType =
  | 'start'
  | 'gpm_prefetch'
  | 'db_insert'
  | 'db_update'
  | 'db_skip'
  | 'db_error'
  | 'gpm_create'
  | 'gpm_update'
  | 'gpm_skip'
  | 'gpm_error'
  | 'tombstone_gpm'
  | 'tombstone_db'
  | 'tombstone_error'
  | 'done'
  | 'fatal';

interface SyncEvent {
  type: EventType;
  email?: string;
  message?: string;
  inserted?: number;
  updated?: number;
  deleted?: number;
  gpmCreated?: number;
  gpmUpdated?: number;
  gpmDeleted?: number;
  errors?: string[];
}

interface LogLine {
  id: number;
  type: EventType;
  text: string;
  time: string;
}

interface Props {
  onClose: () => void;
  onDone: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function eventColor(type: EventType): string {
  if (type === 'db_insert' || type === 'gpm_create') return 'text-emerald-400';
  if (type === 'db_update' || type === 'gpm_update') return 'text-sky-400';
  if (type === 'db_skip'   || type === 'gpm_skip')   return 'text-slate-500';
  if (type === 'db_error'  || type === 'gpm_error' || type === 'tombstone_error' || type === 'fatal') return 'text-rose-400';
  if (type === 'tombstone_gpm' || type === 'tombstone_db') return 'text-amber-400';
  if (type === 'done') return 'text-emerald-300';
  return 'text-slate-400';
}

function eventPrefix(type: EventType): string {
  if (type === 'db_insert')  return '[ DB  ] ➕';
  if (type === 'db_update')  return '[ DB  ] ✏️ ';
  if (type === 'db_skip')    return '[ DB  ] ─ ';
  if (type === 'db_error')   return '[ DB  ] ✗ ';
  if (type === 'gpm_create') return '[ GPM ] ➕';
  if (type === 'gpm_update') return '[ GPM ] ✏️ ';
  if (type === 'gpm_skip')   return '[ GPM ] ─ ';
  if (type === 'gpm_error')  return '[ GPM ] ✗ ';
  if (type === 'tombstone_gpm') return '[ DEL ] 🗑 GPM';
  if (type === 'tombstone_db')  return '[ DEL ] 🗑 DB ';
  if (type === 'tombstone_error') return '[ DEL ] ✗ ';
  if (type === 'done')  return '[ ✓  ] ';
  if (type === 'fatal') return '[ ERR ] ';
  if (type === 'start') return '[ ···] ';
  if (type === 'gpm_prefetch') return '[ GPM ] ';
  return '       ';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SheetSyncStatusModal({ onClose, onDone }: Props) {
  const [logs, setLogs]       = useState<LogLine[]>([]);
  const [running, setRunning] = useState(true);
  const [done, setDone]       = useState(false);
  const [summary, setSummary] = useState<SyncEvent | null>(null);
  const [fatal, setFatal]     = useState<string | null>(null);

  // Counters updated as events stream in
  const [counts, setCounts] = useState({ inserted: 0, updated: 0, deleted: 0, gpmCreated: 0, gpmUpdated: 0, gpmDeleted: 0, errors: 0 });

  const logEndRef   = useRef<HTMLDivElement | null>(null);
  const startedRef  = useRef(false);

  const addLog = (type: EventType, text: string) => {
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), type, text, time: now() }]);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startSync = async () => {
    setRunning(true);
    setDone(false);
    setFatal(null);
    setSummary(null);
    setLogs([]);
    setCounts({ inserted: 0, updated: 0, deleted: 0, gpmCreated: 0, gpmUpdated: 0, gpmDeleted: 0, errors: 0 });

    try {
      const res = await fetch('/api/sync-from-sheet', { method: 'POST' });

      // Non-streaming fallback (old route)
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('text/event-stream')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        addLog('done', data.message ?? 'Sync complete');
        setSummary(data);
        setDone(true);
        onDone();
        return;
      }

      // Streaming path
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: sd, value } = await reader.read();
        if (sd) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: SyncEvent;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }

          const label = ev.email ? `${ev.email}: ${ev.message ?? ''}` : (ev.message ?? ev.type);
          addLog(ev.type, label.trim());

          if (ev.type === 'db_insert')  setCounts(c => ({ ...c, inserted:   c.inserted   + 1 }));
          if (ev.type === 'db_update')  setCounts(c => ({ ...c, updated:    c.updated    + 1 }));
          if (ev.type === 'tombstone_db') setCounts(c => ({ ...c, deleted:  c.deleted    + 1 }));
          if (ev.type === 'gpm_create') setCounts(c => ({ ...c, gpmCreated: c.gpmCreated + 1 }));
          if (ev.type === 'gpm_update') setCounts(c => ({ ...c, gpmUpdated: c.gpmUpdated + 1 }));
          if (ev.type === 'tombstone_gpm') setCounts(c => ({ ...c, gpmDeleted: c.gpmDeleted + 1 }));
          if (ev.type === 'db_error' || ev.type === 'gpm_error' || ev.type === 'tombstone_error') {
            setCounts(c => ({ ...c, errors: c.errors + 1 }));
          }

          if (ev.type === 'done') {
            setSummary(ev);
            setDone(true);
            onDone();
          }
          if (ev.type === 'fatal') {
            setFatal(ev.message ?? 'Unknown error');
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFatal(msg);
      addLog('fatal', msg);
    } finally {
      setRunning(false);
      setDone(true);
    }
  };

  // Auto-start on mount
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startSync();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Counters ──────────────────────────────────────────────────────────────

  const statPills = [
    { label: 'Inserted',    value: counts.inserted,   color: '#34d399' },
    { label: 'Updated',     value: counts.updated,    color: '#38bdf8' },
    { label: 'Deleted',     value: counts.deleted,    color: '#fb923c' },
    { label: 'GPM Created', value: counts.gpmCreated, color: '#34d399' },
    { label: 'GPM Updated', value: counts.gpmUpdated, color: '#38bdf8' },
    { label: 'GPM Deleted', value: counts.gpmDeleted, color: '#fb923c' },
    { label: 'Errors',      value: counts.errors,     color: '#f87171' },
  ];

  return (
    <div className="modal-overlay" onClick={e => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxWidth: 860 }}>

        {/* ── Header ── */}
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {running
              ? <><span className="spinner" style={{ width: 16, height: 16, flexShrink: 0 }} /> Syncing from Google Sheet…</>
              : fatal
              ? '❌ Sync Failed'
              : done
              ? '✅ Sync Complete'
              : '🔄 Sheet Sync'}
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Live counter pills ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {statPills.map(p => (
              <div
                key={p.label}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 8,
                  background: `${p.color}14`, border: `1px solid ${p.color}30`,
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 700, color: p.color, fontSize: 14 }}>{p.value}</span>
                <span style={{ color: '#64748b' }}>{p.label}</span>
              </div>
            ))}
          </div>

          {/* ── Progress pulse bar ── */}
          <div
            style={{
              height: 3, borderRadius: 4,
              background: running
                ? 'linear-gradient(90deg, #818cf8, #34d399, #818cf8)'
                : fatal ? '#f87171' : '#34d399',
              backgroundSize: running ? '200% 100%' : undefined,
              animation: running ? 'progress-pulse 1.8s linear infinite' : undefined,
            }}
          />

          {/* ── Log terminal ── */}
          <div
            className="log-terminal"
            style={{ maxHeight: 420, minHeight: 220, fontSize: 12, fontFamily: 'monospace', overflowY: 'auto' }}
          >
            {logs.length === 0 && running && (
              <div className="log-line text-slate-600">Connecting…</div>
            )}
            {logs.map(l => (
              <div key={l.id} className={`log-line ${eventColor(l.type)}`} style={{ display: 'flex', gap: 10, lineHeight: 1.6 }}>
                <span style={{ color: '#374151', flexShrink: 0, userSelect: 'none' }}>{l.time}</span>
                <span style={{ color: '#4b5563', flexShrink: 0, userSelect: 'none' }}>{eventPrefix(l.type)}</span>
                <span style={{ wordBreak: 'break-all' }}>{l.text}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          {/* ── Fatal error banner ── */}
          {fatal && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: '#f8717114', border: '1px solid #f8717130',
              color: '#f87171',
            }}>
              ⚠️ {fatal}
            </div>
          )}

          {/* ── Summary banner ── */}
          {summary && !fatal && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: '#34d39914', border: '1px solid #34d39930',
              color: '#34d399',
            }}>
              ✅ {summary.message}
              {summary.errors && summary.errors.length > 0 && (
                <div style={{ marginTop: 6, color: '#f87171', fontSize: 12 }}>
                  {summary.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="modal-footer">
          {done && !running && (
            <button
              className="btn btn-secondary"
              onClick={() => { startedRef.current = false; startSync(); }}
            >
              🔄 Run Again
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose} disabled={running}>
            {running ? 'Syncing…' : 'Close'}
          </button>
        </div>
      </div>

      {/* Inline keyframe for the progress pulse */}
      {/* eslint-disable-next-line react/no-danger */}
      <style>{`
        @keyframes progress-pulse {
          0%   { background-position: 0%   50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>
    </div>
  );
}
