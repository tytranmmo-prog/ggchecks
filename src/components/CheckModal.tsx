'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  id: number;
  email: string;
  password: string;
  totpSecret: string;
  monthlyCredits?: string;
  additionalCredits?: string;
  additionalCreditsExpiry?: string;
  memberActivities?: MemberActivity[];
  lastChecked?: string;
  status?: string;
}

interface MemberActivity {
  name: string;
  credit: number;
  checkAt?: string;
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
  const startedRef = useRef(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startCheck = async () => {
    setRunning(true);
    setLogs([{ text: `🥷 Starting stealth check for ${account.email}...`, type: 'info' }]);
    setResult(null);
    setDone(false);

    try {
      const body: Record<string, unknown> = {
        email: account.email,
        password: account.password,
        totpSecret: account.totpSecret,
        id: account.id,
      };

      const response = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
              if (event.screenshotUrl) {
                setLogs(prev => [...prev, { text: `📸 Screenshot saved locally: ${event.screenshotUrl}`, type: 'info' }]);
              }
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

  void startedRef;

  return (
    <div className="modal-overlay" onClick={(e) => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>
            {running
              ? <><span className="spinner" /> Checking Credits (CDP)</>
              : done && result ? '✅ Check Complete'
              : done ? '❌ Check Failed'
              : '🥷 Stealth Check'}
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body">
          {/* Account info */}
          <div className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg mb-4 font-mono text-[12.5px] text-accent">
            {account.email}
          </div>

          {/* Terminal log */}
          <div className="log-terminal">
            {logs.map((log, i) => {
              const parts = log.text.split(/(https?:\/\/[^\s]+|\/screenshots\/[^\s]+)/g);
              return (
                <div key={i} className={`log-line ${log.type}`}>
                  {parts.map((part, j) =>
                    part.startsWith('http') || part.startsWith('/screenshots/')
                      ? <a key={j} href={part} target="_blank" rel="noopener noreferrer" className="text-[#4da6ff] underline">{part}</a>
                      : part
                  )}
                </div>
              );
            })}
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
                  <div className="result-item col-span-2">
                    <div className="result-item-label">Expires</div>
                    <div className="result-item-value small">{result.additionalCreditsExpiry}</div>
                  </div>
                )}
              </div>

              {result.memberActivities && result.memberActivities.length > 0 && (
                <>
                  <div className="text-[11px] text-slate-600 uppercase tracking-[0.5px] mt-4 mb-2">
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
            <button className="btn btn-secondary" onClick={() => { setDone(false); startCheck(); }}>🔄 Run Again</button>
          )}
          {!running && !done && (
            <button className="btn btn-primary" onClick={startCheck}>🥷 Start Stealth Check</button>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={running}>
            {running ? 'Running...' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
