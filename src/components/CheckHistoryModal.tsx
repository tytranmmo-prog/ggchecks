'use client';

import { useState, useEffect, useCallback } from 'react';

interface MemberActivity {
  name: string;
  credit: number;
}

interface CheckHistoryItem {
  id: number;
  monthlyCredits: string;
  additionalCredits: string;
  additionalCreditsExpiry: string;
  memberActivities: MemberActivity[];
  lastChecked: string;
  status: string;
  screenshot: string;
  createdAt: string;
}

interface Account {
  id: number;
  email: string;
}

interface Props {
  account: Account;
  onClose: () => void;
}

function statusBadge(status: string) {
  if (!status || status === 'pending') return <span className="badge badge-pending">Pending</span>;
  if (status === 'ok')                 return <span className="badge badge-ok">OK</span>;
  return <span className="badge badge-error" title={status}>Error</span>;
}

function fmt(iso: string) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function parseCredits(raw: string) {
  if (!raw) return null;
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return isNaN(n) ? raw : n.toLocaleString();
}

export default function CheckHistoryModal({ account, onClose }: Props) {
  const [items,     setItems]     = useState<CheckHistoryItem[]>([]);
  const [cursor,    setCursor]    = useState<number>(0);
  const [hasMore,   setHasMore]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async (cur: number) => {
    const isFirst = cur === 0;
    isFirst ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const res  = await fetch(`/api/check-history?accountId=${account.id}&cursor=${cur}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');

      setItems(prev => isFirst ? data.items : [...prev, ...data.items]);
      setHasMore(data.hasMore);
      setCursor(data.nextCursor ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [account.id]);

  useEffect(() => { load(0); }, [load]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal modal-lg"
        style={{ maxWidth: 900, width: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2>📋 Check History — <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--slate-400)' }}>{account.email}</span></h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--slate-600)' }}>
              <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
              <div>Loading history…</div>
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#f87171' }}>
              ⚠️ {error}
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--slate-600)' }}>
              No check history yet for this account.
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="accounts-table" style={{ minWidth: 680 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Checked At</th>
                      <th>Monthly Credits</th>
                      <th>Additional</th>
                      <th>Expiry</th>
                      <th>Members</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.id}>
                        <td className="text-slate-600 text-xs">{idx + 1}</td>
                        <td className="mono-cell text-[11px]">{fmt(item.createdAt)}</td>
                        <td>
                          {parseCredits(item.monthlyCredits)
                            ? <span className="credit-value">{parseCredits(item.monthlyCredits)}</span>
                            : <span className="credit-empty">–</span>}
                        </td>
                        <td>
                          {item.additionalCredits
                            ? <span className="credit-value text-accent2">{item.additionalCredits}</span>
                            : <span className="credit-empty">–</span>}
                        </td>
                        <td className="mono-cell text-[11px]">{item.additionalCreditsExpiry || '–'}</td>
                        <td>
                          {Array.isArray(item.memberActivities) && item.memberActivities.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {item.memberActivities.map((m, mi) => (
                                <div key={mi} style={{ fontSize: 11, color: 'var(--slate-400)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                  <span style={{ color: 'var(--slate-300)' }}>{m.name}</span>
                                  <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
                                    {Number(m.credit).toLocaleString()} cr
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="credit-empty">–</span>
                          )}
                        </td>
                        <td>{statusBadge(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Load more */}
              {hasMore && (
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => load(cursor)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…</>
                    ) : 'Load more'}
                  </button>
                </div>
              )}

              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: 'var(--slate-600)' }}>
                Showing {items.length} record{items.length !== 1 ? 's' : ''}
                {hasMore ? ' — more available' : ' — all records loaded'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
