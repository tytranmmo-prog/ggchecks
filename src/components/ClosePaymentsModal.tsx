'use client';

import { useState, useEffect, useRef } from 'react';

interface Account {
  id: number;
  email: string;
}

interface ClosePaymentsResult {
  success: boolean;
  account: string;
  closedAt: string;
  error?: string;
}

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export default function ClosePaymentsModal({ account, onClose, onSaved, showToast }: Props) {
  const [logs, setLogs] = useState<{ text: string; type: 'log' | 'error' | 'info' | 'success' }[]>([]);
  const [result, setResult] = useState<ClosePaymentsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startAutoChange = async () => {
    setRunning(true);
    setDone(false);
    setResult(null);
    setLogs([{ text: `🚀 Launching close payments profile for ${account.email}...`, type: 'info' }]);

    try {
      const response = await fetch('/api/run-close-payments', {
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
              const isError = /✗|❌|error|failed/i.test(text) && !/✅/.test(text);
              const isSuccess = /✅/.test(text);
              setLogs(prev => [...prev, { text, type: isSuccess ? 'success' : isError ? 'error' : 'log' }]);
            } else if (event.type === 'result') {
              setResult(event.data);
              setLogs(prev => [...prev, { text: '✅ Payments profile closed!', type: 'success' }]);
              showToast('Payments profile closed ✓', 'success');
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

  return (
    <div className="modal-overlay" onClick={(e) => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>
            {running
              ? <><span className="spinner" /> Closing Payments...</>
              : done && result ? '✅ Payments Closed'
              : done ? '❌ Closure Failed'
              : '💳 Close Payments Profile'}
          </h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={running}>✕</button>
        </div>
        <div className="modal-body">
          <div className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg mb-4 font-mono text-[12.5px] text-accent">
            {account.email}
          </div>

          {!running && !done && (
            <div className="text-sm mb-4 text-slate-300 bg-red-500/10 border border-red-500/20 p-4 rounded-xl">
              <p className="font-semibold text-red-400 mb-2">⚠️ Warning</p>
              <p>This action will permanently close the Google Payments profile for this account.</p>
            </div>
          )}

          {(!running && !done) ? (
             <div className="flex justify-center py-4">
                <button className="btn btn-danger btn-lg px-8 py-3 text-lg" onClick={startAutoChange}>
                  🚨 Execute Automation
                </button>
             </div>
          ) : (
            <div className="log-terminal max-h-[300px]">
              {logs.map((log, i) => (
                <div key={i} className={`log-line ${log.type}`}>{log.text}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

          {result?.success && (
            <div className="result-grid mt-4">
              <div className="result-item">
                <div className="result-item-label">Closed At</div>
                <div className="result-item-value small">
                  {new Date(result.closedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {done && !running && (
            <button className="btn btn-secondary" onClick={() => { setDone(false); setResult(null); startAutoChange(); }}>🔄 Retry</button>
          )}
          <button className="btn btn-primary" onClick={onClose} disabled={running}>
            {running ? 'Running...' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
