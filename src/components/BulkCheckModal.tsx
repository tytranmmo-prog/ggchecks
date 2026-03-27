'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  rowIndex: number;
  email: string;
  password: string;
  totpSecret: string;
}

type AccountStatus = 'queued' | 'running' | 'done' | 'error';

interface AccountState {
  rowIndex: number;
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
    accounts.map(a => ({ rowIndex: a.rowIndex, email: a.email, status: 'queued' }))
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [chromePort, setChromePort] = useState<number | null>(null);
  const [summary, setSummary] = useState<{ completed: number; errors: number } | null>(null);
  const startedRef = useRef(false);

  const updateState = (rowIndex: number, patch: Partial<AccountState>) =>
    setStates(prev => prev.map(s => s.rowIndex === rowIndex ? { ...s, ...patch } : s));

  const startBulk = async () => {
    setRunning(true);
    setDone(false);
    setSummary(null);
    setStates(accounts.map(a => ({ rowIndex: a.rowIndex, email: a.email, status: 'queued' })));

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
            else if (ev.type === 'account_start') updateState(ev.rowIndex, { status: 'running' });
            else if (ev.type === 'account_done') updateState(ev.rowIndex, {
              status: 'done',
              monthlyCredits: ev.result?.monthlyCredits,
              additionalCredits: ev.result?.additionalCredits,
            });
            else if (ev.type === 'account_error') updateState(ev.rowIndex, { status: 'error', error: ev.error });
            else if (ev.type === 'done') {
              setSummary({ completed: ev.completed, errors: ev.errors });
              setDone(true);
              onDone();
            }
            else if (ev.type === 'fatal') {
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

  const doneCount = states.filter(s => s.status === 'done').length;
  const errorCount = states.filter(s => s.status === 'error').length;
  const runningCount = states.filter(s => s.status === 'running').length;
  const progress = Math.round(((doneCount + errorCount) / accounts.length) * 100);

  const statusIcon = (s: AccountStatus) => {
    if (s === 'queued') return <span style={{ color: 'var(--text-muted)' }}>⏳</span>;
    if (s === 'running') return <span className="spinner" style={{ width: 12, height: 12 }} />;
    if (s === 'done') return <span style={{ color: 'var(--success)' }}>✅</span>;
    return <span style={{ color: 'var(--danger)' }}>❌</span>;
  };

  return (
    <div className="modal-overlay" onClick={e => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxWidth: 780 }}>

        {/* Header */}
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {running ? <><span className="spinner" /> Bulk Check Running</> : done ? '✅ Bulk Check Complete' : '⚡ Bulk Check'}
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
              ({accounts.length} accounts)
            </span>
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px' }}>

          {/* Status bar */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {chromePort && (
              <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                🟢 Chrome on port {chromePort}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              🔄 {runningCount} running · ✅ {doneCount} done · ❌ {errorCount} errors · ⏳ {accounts.length - doneCount - errorCount - runningCount} queued
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 6, marginBottom: 20, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: errorCount > 0
                ? `linear-gradient(90deg, var(--success) ${Math.round(doneCount / accounts.length * 100)}%, var(--danger) 0%)`
                : 'var(--success)',
              borderRadius: 6,
              transition: 'width 0.4s ease',
            }} />
          </div>

          {/* Account table */}
          <div style={{ maxHeight: 400, overflowY: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
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
                  <tr key={s.rowIndex}>
                    <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                    <td className="email-cell" style={{ fontSize: 12 }}>{s.email}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        {statusIcon(s.status)}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{s.status}</span>
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--success)', fontSize: 12 }}>
                      {s.monthlyCredits ? parseInt(s.monthlyCredits.replace(/,/g, ''), 10).toLocaleString() : '–'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--accent2)', fontSize: 12 }}>
                      {s.additionalCredits || (s.error ? <span title={s.error} style={{ color: 'var(--danger)', cursor: 'help' }}>error ⚠</span> : '–')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          {summary && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', fontSize: 13, color: 'var(--success)' }}>
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
