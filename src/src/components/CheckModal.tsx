'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  rowIndex: number;
  email: string;
  password: string;
  totpSecret: string;
  monthlyCredits?: string;
  additionalCredits?: string;
  additionalCreditsExpiry?: string;
  memberActivities?: string;
  lastChecked?: string;
  status?: string;
}

interface MemberActivity {
  name: string;
  credit: number;
  checkAt: string;
}

interface CheckResult {
  success: boolean;
  account: string;
  checkAt: string;
  monthlyCredits: string;
  additionalCredits: string;
  additionalCreditsExpiry: string;
  memberActivities: MemberActivity[];
  error?: string;
}

interface Props {
  account: Account;
  onClose: () => void;
  onDone: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export default function CheckModal({ account, onClose, onDone, showToast }: Props) {
  const [logs, setLogs] = useState<{ text: string; type: 'log' | 'error' | 'info' | 'success' }[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startCheck = async () => {
    setRunning(true);
    setLogs([{ text: `⚡ Starting check for ${account.email}...`, type: 'info' }]);
    setResult(null);
    setDone(false);

    try {
      const response = await fetch('/api/check', {
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
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'log') {
              const text = event.message as string;
              const isError = text.includes('✗') || text.toLowerCase().includes('error');
              setLogs(prev => [...prev, { text, type: isError ? 'error' : 'log' }]);
            } else if (event.type === 'result') {
              setResult(event.data);
              setLogs(prev => [...prev, { text: '✅ Check completed successfully!', type: 'success' }]);
              showToast('Credits checked & saved ✓', 'success');
              onDone();
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

  // Auto-start on mount
  useEffect(() => { startCheck(); }, []); // eslint-disable-line

  return (
    <div className="modal-overlay" onClick={(e) => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>
            {running ? <><span className="spinner" /> Checking Credits</> : done && result ? '✅ Check Complete' : done ? '❌ Check Failed' : '🔍 Credit Check'}
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body">
          {/* Account info */}
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

          {/* Results */}
          {result && result.success && (
            <>
              <div className="result-grid">
                <div className="result-item">
                  <div className="result-item-label">Monthly Credits</div>
                  <div className="result-item-value">{result.monthlyCredits || '–'}</div>
                </div>
                <div className="result-item">
                  <div className="result-item-label">Additional Credits</div>
                  <div className="result-item-value">{result.additionalCredits || '–'}</div>
                </div>
                {result.additionalCreditsExpiry && (
                  <div className="result-item" style={{ gridColumn: '1 / -1' }}>
                    <div className="result-item-label">Expires</div>
                    <div className="result-item-value small">{result.additionalCreditsExpiry}</div>
                  </div>
                )}
              </div>

              {result.memberActivities && result.memberActivities.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 16, marginBottom: 8 }}>
                    Family Members ({result.memberActivities.length})
                  </div>
                  <div className="member-list">
                    {result.memberActivities.map((m, i) => (
                      <div key={i} className="member-item">
                        <span className="member-name">{m.name}</span>
                        <span className="member-credit">{m.credit.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          {done && !running && (
            <button className="btn btn-secondary" onClick={() => { setDone(false); startCheck(); }}>
              🔄 Run Again
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
