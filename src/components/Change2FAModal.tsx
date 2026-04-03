'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  id: number;
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

  const [logs, setLogs] = useState<{ text: string; type: 'log' | 'error' | 'info' | 'success' }[]>([]);
  const [result, setResult] = useState<Change2FAResult | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const [manualSecret, setManualSecret] = useState(account.totpSecret);
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      startAutoChange();
    }
  }, []); // eslint-disable-line

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
          userEmail: account.email,
          poolType: 'gpm',
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
              setLogs(prev => [...prev, { text, type: isSuccess ? 'success' : isError ? 'error' : 'log' }]);
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

  const handleManualSave = async () => {
    if (!manualSecret.trim()) return;
    setSavingManual(true);
    try {
      const res = await fetch('/api/update-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, totpSecret: manualSecret.trim() }),
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

  /* ── Mode: Choose ── */
  if (mode === 'choose') {
    return (
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <div className="modal-header">
            <h2>🔐 Change 2FA Secret</h2>
            <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg px-3.5 py-2.5 mb-5">
              <div className="text-[11px] text-slate-600 mb-0.5 uppercase tracking-[0.4px]">Account</div>
              <div className="font-mono text-sm text-accent">{account.email}</div>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setMode('auto'); startAutoChange(); }}
                className="flex items-start gap-3.5 p-4 rounded-xl bg-indigo-500/[0.08] border border-indigo-500/30 text-left text-inherit cursor-pointer transition-colors duration-200 hover:bg-indigo-500/[0.15]"
              >
                <span className="text-3xl leading-none">🤖</span>
                <div>
                  <div className="font-semibold mb-1 text-accent">Automatic Rotation</div>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    Logs into Google, navigates the 2FA settings, rotates the secret, and saves the new key — fully automated.
                  </div>
                </div>
              </button>
              <button
                onClick={() => setMode('manual')}
                className="flex items-start gap-3.5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] text-left text-inherit cursor-pointer transition-colors duration-200 hover:bg-white/[0.06]"
              >
                <span className="text-3xl leading-none">✏️</span>
                <div>
                  <div className="font-semibold mb-1">Manual Update</div>
                  <div className="text-xs text-slate-600 leading-relaxed">
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

  /* ── Mode: Auto ── */
  if (mode === 'auto') {
    return (
      <div className="modal-overlay" onClick={(e) => !running && e.target === e.currentTarget && onClose()}>
        <div className="modal modal-lg">
          <div className="modal-header">
            <h2>
              {running
                ? <><span className="spinner" /> Rotating 2FA...</>
                : done && result ? '✅ 2FA Rotated'
                : done ? '❌ Rotation Failed'
                : '🔐 2FA Rotation'}
            </h2>
            <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
          </div>
          <div className="modal-body">
            <div className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg mb-4 font-mono text-[12.5px] text-accent">
              {account.email}
            </div>
            <div className="log-terminal">
              {logs.map((log, i) => (
                <div key={i} className={`log-line ${log.type}`}>{log.text}</div>
              ))}
              <div ref={logEndRef} />
            </div>
            {result?.success && (
              <div className="result-grid mt-4">
                <div className="result-item col-span-2">
                  <div className="result-item-label">New TOTP Secret</div>
                  <div className="result-item-value small font-mono tracking-widest text-sm">{result.newTotpSecret}</div>
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
              <button className="btn btn-secondary" onClick={() => { setDone(false); setResult(null); startAutoChange(); }}>🔄 Retry</button>
            )}
            {done && !running && (
              <button className="btn btn-secondary opacity-70" onClick={() => setMode('manual')}>✏️ Manual</button>
            )}
            <button className="btn btn-primary" onClick={onClose} disabled={running}>
              {running ? 'Running...' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Mode: Manual ── */
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>✏️ Manual 2FA Update</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="mb-4 px-3.5 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg">
            <div className="text-[11px] text-slate-600 mb-0.5 uppercase tracking-[0.4px]">Account</div>
            <div className="font-mono text-sm text-accent">{account.email}</div>
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
          <div className="text-xs text-slate-600 mt-2">
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
