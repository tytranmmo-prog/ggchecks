'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  id: number;
  email: string;
  password: string;
  totpSecret: string;
}

type AccountStatus = 'queued' | 'running' | 'done' | 'error';

interface AccountState {
  id: number;
  email: string;
  status: AccountStatus;
  monthlyCredits?: string;
  additionalCredits?: string;
  error?: string;
}

interface Props {
  accounts: Account[];
  onClose: () => void;
  onDone: () => void;
}

export default function BulkCheckModal({ accounts, onClose, onDone }: Props) {
  const [states, setStates] = useState<AccountState[]>(
    accounts.map(a => ({ id: a.id, email: a.email, status: 'queued' }))
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [chromePort, setChromePort] = useState<number | null>(null);
  const [summary, setSummary] = useState<{ completed: number; errors: number } | null>(null);
  const startedRef = useRef(false);

  const updateState = (id: number, patch: Partial<AccountState>) =>
    setStates(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const startBulk = async () => {
    setRunning(true);
    setDone(false);
    setSummary(null);
    setStates(accounts.map(a => ({ id: a.id, email: a.email, status: 'queued' })));

    try {
      const res = await fetch('/api/bulk-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: sd, value } = await reader.read();
        if (sd) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'chrome_ready') setChromePort(ev.port);
            else if (ev.type === 'account_start') updateState(ev.id, { status: 'running' });
            else if (ev.type === 'account_done') updateState(ev.id, {
              status: 'done',
              monthlyCredits: ev.result?.monthlyCredits,
              additionalCredits: ev.result?.additionalCredits,
            });
            else if (ev.type === 'account_error') updateState(ev.id, { status: 'error', error: ev.error });
            else if (ev.type === 'done') {
              setSummary({ completed: ev.completed, errors: ev.errors });
              setDone(true);
              onDone();
            } else if (ev.type === 'fatal') {
              setStates(prev => prev.map(s => s.status === 'queued' ? { ...s, status: 'error', error: ev.message } : s));
              setDone(true);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      console.error('Bulk check error:', e);
    } finally {
      setRunning(false);
      setDone(true);
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startBulk();
  }, []); // eslint-disable-line

  const doneCount    = states.filter(s => s.status === 'done').length;
  const errorCount   = states.filter(s => s.status === 'error').length;
  const runningCount = states.filter(s => s.status === 'running').length;
  const progress     = Math.round(((doneCount + errorCount) / accounts.length) * 100);

  const statusIcon = (s: AccountStatus) => {
    if (s === 'queued')  return <span className="text-slate-600">⏳</span>;
    if (s === 'running') return <span className="spinner" style={{ width: 12, height: 12 }} />;
    if (s === 'done')    return <span className="text-success">✅</span>;
    return <span className="text-danger">❌</span>;
  };

  return (
    <div className="modal-overlay" onClick={e => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxWidth: 780 }}>

        {/* Header */}
        <div className="modal-header">
          <h2>
            {running ? <><span className="spinner" /> Bulk Check Running</> : done ? '✅ Bulk Check Complete' : '⚡ Bulk Check'}
            <span className="text-sm font-normal text-slate-600 ml-1">({accounts.length} accounts)</span>
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px' }}>

          {/* Status bar */}
          <div className="flex gap-4 mb-4 flex-wrap items-center">
            {chromePort && (
              <span className="text-xs text-success flex items-center gap-1">🟢 Chrome on port {chromePort}</span>
            )}
            <span className="text-xs text-slate-600">
              🔄 {runningCount} running · ✅ {doneCount} done · ❌ {errorCount} errors · ⏳ {accounts.length - doneCount - errorCount - runningCount} queued
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-white/[0.06] rounded-full mb-5 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-[400ms]"
              style={{
                width: `${progress}%`,
                background: errorCount > 0
                  ? `linear-gradient(90deg, #34d399 ${Math.round(doneCount / accounts.length * 100)}%, #f87171 0%)`
                  : '#34d399',
              }}
            />
          </div>

          {/* Account table */}
          <div className="max-h-[400px] overflow-y-auto rounded-xl border border-white/[0.08]">
            <table style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Email</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Status</th>
                  <th style={{ width: 90 }}>Monthly</th>
                  <th style={{ width: 90 }}>Additional</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s, i) => (
                  <tr key={s.id}>
                    <td className="text-slate-600 text-[11px]">{i + 1}</td>
                    <td className="email-cell" style={{ fontSize: 12 }}>{s.email}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="flex items-center justify-center gap-1">
                        {statusIcon(s.status)}
                        <span className="text-[11px] text-slate-600 capitalize">{s.status}</span>
                      </span>
                    </td>
                    <td className="font-mono text-success text-xs">
                      {s.monthlyCredits ? parseInt(s.monthlyCredits.replace(/,/g, ''), 10).toLocaleString() : '–'}
                    </td>
                    <td className="font-mono text-accent2 text-xs">
                      {s.additionalCredits || (s.error ? <span title={s.error} className="text-danger cursor-help">error ⚠</span> : '–')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          {summary && (
            <div className="mt-4 px-3.5 py-2.5 rounded-lg bg-success/[0.08] border border-success/20 text-sm text-success">
              ✅ Done — {summary.completed} succeeded, {summary.errors} failed out of {accounts.length} accounts
            </div>
          )}
        </div>

        <div className="modal-footer">
          {done && (
            <button className="btn btn-secondary" onClick={() => { startedRef.current = false; startBulk(); }}>
              🔄 Run Again
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose} disabled={running}>
            {running ? `Running... (${doneCount + errorCount}/${accounts.length})` : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
