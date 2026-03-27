'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  rowIndex: number;
  email: string;
  password: string;
  totpSecret: string;
}

interface Change2FAResult {
  success: boolean;
  account: string;
  newTotpSecret: string;
  changedAt: string;
  error?: string;
}

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

type Mode = 'choose' | 'auto' | 'manual';

export default function Change2FAModal({ account, onClose, onSaved, showToast }: Props) {
  const [mode, setMode] = useState<Mode>('auto');

  // ── Automated mode state ──
  const [logs, setLogs] = useState<{ text: string; type: 'log' | 'error' | 'info' | 'success' }[]>([]);
  const [result, setResult] = useState<Change2FAResult | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // ── Manual mode state ──
  const [manualSecret, setManualSecret] = useState(account.totpSecret);
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Auto-start on mount
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      startAutoChange();
    }
  }, []); // eslint-disable-line

  // ── Automated: run change2fa.js ──
  const startAutoChange = async () => {
    setRunning(true);
    setDone(false);
    setResult(null);
    setLogs([{ text: `🚀 Launching 2FA rotation for ${account.email}...`, type: 'info' }]);

    try {
      const response = await fetch('/api/run-change2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
          totpSecret: account.totpSecret,
          rowIndex: account.rowIndex,
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'log') {
              const text = event.message as string;
              const isError = /✗|❌|error/i.test(text) && !/✅/.test(text);
              const isSuccess = /✅/.test(text);
              setLogs(prev => [...prev, {
                text,
                type: isSuccess ? 'success' : isError ? 'error' : 'log',
              }]);
            } else if (event.type === 'result') {
              setResult(event.data);
              setLogs(prev => [...prev, { text: '✅ 2FA rotation completed!', type: 'success' }]);
              showToast('2FA secret rotated & saved ✓', 'success');
              onSaved();
            } else if (event.type === 'error') {
              setLogs(prev => [...prev, { text: `❌ ${event.message}`, type: 'error' }]);
              showToast(event.message, 'error');
            } else if (event.type === 'done') {
              setDone(true);
              setRunning(false);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed';
      setLogs(prev => [...prev, { text: `❌ ${msg}`, type: 'error' }]);
      showToast(msg, 'error');
    } finally {
      setRunning(false);
      setDone(true);
    }
  };

  // ── Manual: just save to sheet ──
  const handleManualSave = async () => {
    if (!manualSecret.trim()) return;
    setSavingManual(true);
    try {
      const res = await fetch('/api/update-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex: account.rowIndex, totpSecret: manualSecret.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast('2FA secret updated ✓', 'success');
      onSaved();
      onClose();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update', 'error');
    } finally {
      setSavingManual(false);
    }
  };

  // ── Mode: Choose ──
  if (mode === 'choose') {
    return (
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <div className="modal-header">
            <h2>🔐 Change 2FA Secret</h2>
            <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Account</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)' }}>{account.email}</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Automated option */}
              <button
                onClick={() => { setMode('auto'); startAutoChange(); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '16px 18px', borderRadius: 10,
                  background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)',
                  cursor: 'pointer', textAlign: 'left', color: 'inherit',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
              >
                <span style={{ fontSize: 28, lineHeight: 1 }}>🤖</span>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent)' }}>Automatic Rotation</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Logs into Google, navigates the 2FA settings, rotates the secret, and saves the new key — fully automated.
                  </div>
                </div>
              </button>

              {/* Manual option */}
              <button
                onClick={() => setMode('manual')}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '16px 18px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                  cursor: 'pointer', textAlign: 'left', color: 'inherit',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              >
                <span style={{ fontSize: 28, lineHeight: 1 }}>✏️</span>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Manual Update</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Paste a new TOTP secret directly. Only updates the stored key in the spreadsheet.
                  </div>
                </div>
              </button>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode: Auto ──
  if (mode === 'auto') {
    return (
      <div className="modal-overlay" onClick={(e) => !running && e.target === e.currentTarget && onClose()}>
        <div className="modal modal-lg">
          <div className="modal-header">
            <h2>
              {running
                ? <><span className="spinner" /> Rotating 2FA...</>
                : done && result
                  ? '✅ 2FA Rotated'
                  : done
                    ? '❌ Rotation Failed'
                    : '🔐 2FA Rotation'}
            </h2>
            <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
          </div>

          <div className="modal-body">
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16, fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--accent)' }}>
              {account.email}
            </div>

            {/* Terminal log */}
            <div className="log-terminal">
              {logs.map((log, i) => (
                <div key={i} className={`log-line ${log.type}`}>{log.text}</div>
              ))}
              <div ref={logEndRef} />
            </div>

            {/* Success result card */}
            {result?.success && (
              <div className="result-grid" style={{ marginTop: 16 }}>
                <div className="result-item" style={{ gridColumn: '1 / -1' }}>
                  <div className="result-item-label">New TOTP Secret</div>
                  <div className="result-item-value small" style={{ fontFamily: 'var(--mono)', letterSpacing: 2, fontSize: 13 }}>
                    {result.newTotpSecret}
                  </div>
                </div>
                <div className="result-item">
                  <div className="result-item-label">Changed At</div>
                  <div className="result-item-value small">
                    {new Date(result.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            {done && !running && (
              <button className="btn btn-secondary" onClick={() => { setDone(false); setResult(null); startAutoChange(); }}>
                🔄 Retry
              </button>
            )}
            {done && !running && (
              <button className="btn btn-secondary" onClick={() => setMode('manual')} style={{ opacity: 0.7 }}>
                ✏️ Manual
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose} disabled={running}>
              {running ? 'Running...' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode: Manual ──
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>✏️ Manual 2FA Update</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Account</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)' }}>{account.email}</div>
          </div>
          <div className="form-group">
            <label className="form-label">New TOTP Secret (Base32)</label>
            <input
              className="form-input"
              type="text"
              value={manualSecret}
              onChange={e => setManualSecret(e.target.value)}
              placeholder="e.g. JBSWY3DPEHPK3PXP"
              autoFocus
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            💡 This only updates the stored secret in the spreadsheet. The account&apos;s Google 2FA settings are left unchanged.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => setMode('choose')}>← Back</button>
          <button className="btn btn-warning" onClick={handleManualSave} disabled={savingManual || !manualSecret.trim()}>
            {savingManual ? <><span className="spinner" /> Saving...</> : '🔐 Update Secret'}
          </button>
        </div>
      </div>
    </div>
  );
}
