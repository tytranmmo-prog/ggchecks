'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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
  const startedRef = useRef(false);

  // Stealth mode state
  const [stealthMode, setStealthMode] = useState(true);
  const [debugPort, setDebugPort] = useState(9222);
  const [chromeStatus, setChromeStatus] = useState<{ running: boolean; browser?: string } | null>(null);
  const [checkingChrome, setCheckingChrome] = useState(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const checkChromeStatus = useCallback(async (port: number) => {
    setCheckingChrome(true);
    try {
      const res = await fetch(`/api/chrome-status?port=${port}`);
      const data = await res.json();
      setChromeStatus(data);
    } catch {
      setChromeStatus({ running: false });
    } finally {
      setCheckingChrome(false);
    }
  }, []);

  // Re-check Chrome status when port changes or stealth mode toggles on
  useEffect(() => {
    if (stealthMode) checkChromeStatus(debugPort);
    else setChromeStatus(null);
  }, [stealthMode, debugPort, checkChromeStatus]);

  const startCheck = async () => {
    setRunning(true);
    setLogs([{
      text: stealthMode
        ? `🥷 Starting stealth check for ${account.email} via CDP port ${debugPort}...`
        : `⚡ Starting check for ${account.email}...`,
      type: 'info',
    }]);
    setResult(null);
    setDone(false);

    try {
      const body: Record<string, unknown> = {
        email: account.email,
        password: account.password,
        totpSecret: account.totpSecret,
        rowIndex: account.rowIndex,
      };
      if (stealthMode) body.debugPort = debugPort;

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

  // Auto-start only when NOT in stealth mode (stealth needs manual confirmation)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!stealthMode) startCheck();
  }, []); // eslint-disable-line

  return (
    <div className="modal-overlay" onClick={(e) => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>
            {running
              ? <><span className="spinner" /> {stealthMode ? 'Stealth Check' : 'Checking Credits'}</>
              : done && result ? '✅ Check Complete'
              : done ? '❌ Check Failed'
              : stealthMode ? '🥷 Stealth Check' : '🔍 Credit Check'}
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body">
          {/* Account info */}
          <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16, fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--accent)' }}>
            {account.email}
          </div>

          {/* Stealth Mode toggle — only show before run starts */}
          {!running && !done && (
            <div style={{
              padding: '12px 14px',
              background: stealthMode ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.03)',
              borderRadius: 10,
              border: `1px solid ${stealthMode ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`,
              marginBottom: 16,
              transition: 'all 0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: stealthMode ? 10 : 0 }}>
                <label className="stealth-toggle">
                  <input
                    type="checkbox"
                    checked={stealthMode}
                    onChange={e => setStealthMode(e.target.checked)}
                  />
                  <span className="stealth-slider" />
                </label>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: stealthMode ? 'rgb(167, 139, 250)' : 'var(--text-primary)' }}>
                    🥷 Stealth Mode (CDP)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    Connect to existing Chrome — bypasses bot detection
                  </div>
                </div>
              </div>

              {stealthMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Debug Port:</span>
                    <input
                      type="number"
                      value={debugPort}
                      onChange={e => setDebugPort(parseInt(e.target.value, 10))}
                      onBlur={() => checkChromeStatus(debugPort)}
                      style={{
                        width: 80,
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'rgba(255,255,255,0.05)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        fontFamily: 'var(--mono)',
                      }}
                    />
                  </div>

                  {/* Chrome status indicator */}
                  {checkingChrome ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="spinner" style={{ width: 10, height: 10 }} /> Checking...
                    </span>
                  ) : chromeStatus ? (
                    <span style={{
                      fontSize: 12,
                      padding: '3px 10px',
                      borderRadius: 20,
                      background: chromeStatus.running ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: chromeStatus.running ? 'rgb(52, 211, 153)' : 'rgb(239, 68, 68)',
                      border: `1px solid ${chromeStatus.running ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    }}>
                      {chromeStatus.running ? `🟢 ${chromeStatus.browser?.split('/')[0] || 'Chrome'} ready` : '🔴 Chrome not found'}
                    </span>
                  ) : null}

                  {!chromeStatus?.running && (
                    <div style={{ width: '100%', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Launch Chrome first:{' '}
                      <code style={{ fontFamily: 'var(--mono)', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>
                        {`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=${debugPort} --remote-allow-origins="*"`}
                      </code>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
          {/* Manual start button for stealth mode (auto-start disabled) */}
          {!running && !done && stealthMode && (
            <button
              className="btn btn-primary"
              onClick={startCheck}
              disabled={!chromeStatus?.running}
              title={!chromeStatus?.running ? 'Chrome not running on this port' : ''}
            >
              🥷 Start Stealth Check
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
