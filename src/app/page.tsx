'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import CheckModal from '@/components/CheckModal';
import CheckHistoryModal from '@/components/CheckHistoryModal';
import Change2FAModal from '@/components/Change2FAModal';
import AddAccountModal from '@/components/AddAccountModal';
import BulkCheckModal from '@/components/BulkCheckModal';
import BulkChange2FAModal from '@/components/BulkChange2FAModal';
import SettingsModal from '@/components/SettingsModal';
import SheetSyncStatusModal from '@/components/SheetSyncStatusModal';

interface MemberActivity {
  name: string;
  email?: string | null;
  credit: number;
}

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
  proxy?: string | null;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function HomePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [checkTarget, setCheckTarget] = useState<Account | null>(null);
  const [twoFATarget, setTwoFATarget] = useState<Account | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkCheck, setShowBulkCheck] = useState(false);
  const [showBulkCheckFailed, setShowBulkCheckFailed] = useState(false);
  const [showBulkCheckSelected, setShowBulkCheckSelected] = useState(false);
  const [showBulkCheckPending, setShowBulkCheckPending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Account | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [resettingProfile, setResettingProfile] = useState<number | null>(null);
  const [resettingAll, setResettingAll] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showBulkChange2FA, setShowBulkChange2FA] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const backgroundSyncStarted = useRef(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const fetchAccounts = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts');
      setAccounts(data.accounts || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const backgroundSync = useCallback(async () => {
    if (backgroundSyncStarted.current) return;
    backgroundSyncStarted.current = true;
    setBackgroundSyncing(true);
    try {
      const res = await fetch('/api/sync-from-sheet', { method: 'POST' });
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      fetchAccounts(true);
    } catch (e) {
      console.error('Background sync failed:', e);
    } finally {
      setBackgroundSyncing(false);
    }
  }, [fetchAccounts]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDelete = async (account: Account) => {
    if (!confirm(`Delete account ${account.email}?`)) return;
    setDeletingRow(account.id);
    try {
      const res = await fetch('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Account deleted', 'success');
      fetchAccounts(true);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    } finally {
      setDeletingRow(null);
    }
  };

  const handleResetProfile = async (account: Account) => {
    if (!confirm(`Reset Chrome profile for ${account.email}?\n\nThis will delete all cached login data. The account will need to authenticate from scratch on the next check.`)) return;
    setResettingProfile(account.id);
    try {
      const res = await fetch('/api/profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Profile reset for ${account.email}`, 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to reset profile', 'error');
    } finally {
      setResettingProfile(null);
    }
  };

  const handleResetAll = async () => {
    if (!confirm('Reset ALL Chrome profiles?\n\nEvery account will need to log in from scratch on the next check.')) return;
    setResettingAll(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('All Chrome profiles deleted', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to reset all profiles', 'error');
    } finally {
      setResettingAll(false);
    }
  };

  const handleSyncFromSheet = () => {
    setShowSyncModal(true);
  };

  const handleExportCSV = async () => {
    const XLSX = await import('xlsx');

    const headers = ['Service Account Email', 'Member Name', 'Member Email', 'Credit', 'Check At'];
    const rows: (string | number)[][] = [headers];
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

    let rowIndex = 1; // data starts at row 1 (after header)

    accounts.forEach(account => {
      const saEmail = account.email;
      const checkAt = account.lastChecked ? new Date(account.lastChecked).toLocaleString() : '–';
      const members = account.memberActivities && account.memberActivities.length > 0
        ? account.memberActivities
        : null;

      if (members) {
        const startRow = rowIndex;
        members.forEach((member, i) => {
          rows.push([
            i === 0 ? saEmail : '',
            member.name || '',
            member.email || '',
            member.credit ?? 0,
            i === 0 ? checkAt : '',
          ]);
          rowIndex++;
        });

        // Merge Service Account Email column (col 0) if multiple members
        if (members.length > 1) {
          merges.push({ s: { r: startRow, c: 0 }, e: { r: rowIndex - 1, c: 0 } });
          // Merge Check At column (col 4) too
          merges.push({ s: { r: startRow, c: 4 }, e: { r: rowIndex - 1, c: 4 } });
        }
      } else {
        rows.push([saEmail, '', '', '', checkAt]);
        rowIndex++;
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Apply column widths
    ws['!cols'] = [
      { wch: 35 }, // Service Account Email
      { wch: 22 }, // Member Name
      { wch: 30 }, // Member Email
      { wch: 10 }, // Credit
      { wch: 22 }, // Check At
    ];

    // Apply merges
    ws['!merges'] = merges;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GG Checks Export');

    XLSX.writeFile(wb, `ggchecks_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filtered = accounts.filter(a =>
    a.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalChecked = accounts.filter(a => a.status === 'ok').length;
  const totalCredits = accounts.reduce((sum, a) => {
    const n = parseInt((a.monthlyCredits || '').replace(/,/g, ''), 10);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  function statusBadge(status?: string) {
    if (!status || status === 'pending') return <span className="badge badge-pending">⏳ Pending</span>;
    if (status === 'ok') return <span className="badge badge-ok">✓ OK</span>;
    if (status.startsWith('error')) return <span className="badge badge-error" title={status}>✗ Error</span>;
    return <span className="badge badge-pending">{status}</span>;
  }

  function formatDate(iso?: string) {
    if (!iso) return '–';
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return '–'; }
  }

  return (
    <div>

      {/* Sticky Header — full viewport width */}
      <div className="sticky top-0 z-50 bg-[rgba(10,13,20,0.82)] backdrop-blur-2xl
                      border-b border-white/[0.07] shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-accent to-accent2 rounded-xl flex items-center justify-center text-xl shadow-[0_0_20px_rgba(79,142,247,0.3)]">
            🤖
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">GG Checks</h1>
            <p className="text-xs text-slate-600 mt-px">Google AI Credit Manager</p>
          </div>
        </div>

        <div className="flex gap-2.5 items-center flex-wrap">
          {backgroundSyncing && (
            <div className="flex items-center gap-2 text-sm text-slate-300 bg-white/[0.04] py-1.5 px-3 rounded-lg border border-white/10 mr-1 font-medium">
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              Auto-syncing sheet...
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => fetchAccounts(true)} disabled={refreshing} title="Refresh accounts">
            <span className={refreshing ? 'spinning' : ''}>↻</span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSyncFromSheet}
            disabled={syncingSheet}
            title="Pull accounts from Google Sheet into the database (sheet is source of truth)"
          >
            🔄 Sync from Sheet
          </button>
          <button className="btn btn-secondary" onClick={handleExportCSV} disabled={accounts.length === 0} title="Export data to Excel (.xlsx)">
            📥 Export Excel
          </button>
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)} title="Configuration Settings">
            ⚙️ Settings
          </button>
          <button
            className="btn btn-warning"
            onClick={handleResetAll}
            disabled={resettingAll || accounts.length === 0}
            title="Delete all Chrome profiles — every account re-authenticates on next check"
          >
            {resettingAll ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Resetting...</> : '🧹 Reset All Profiles'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowBulkCheckPending(true)}
            disabled={accounts.filter(a => !a.status || a.status === 'pending').length === 0}
            title="Check only pending accounts"
          >
            ⏳ Check Pending ({accounts.filter(a => !a.status || a.status === 'pending').length})
          </button>
          <button
            className="btn btn-warning"
            onClick={() => setShowBulkCheckFailed(true)}
            disabled={accounts.filter(a => a.status?.startsWith('error')).length === 0}
            title="Re-check only accounts with failed status"
          >
            ⚠️ Check Failed ({accounts.filter(a => a.status?.startsWith('error')).length})
          </button>
          <button
            className="btn btn-success"
            onClick={() => setShowBulkCheck(true)}
            disabled={accounts.length === 0}
            title="Check all accounts simultaneously"
          >
            ⚡ Check All ({accounts.length})
          </button>
          {selectedRows.size > 0 && (
            <>
              <button
                className="btn btn-primary"
                onClick={() => setShowBulkCheckSelected(true)}
                title="Check only selected accounts"
              >
                ☑ Check Selected ({selectedRows.size})
              </button>
              <button
                className="btn btn-warning"
                onClick={() => setShowBulkChange2FA(true)}
                title="Rotate 2FA secret for selected accounts"
              >
                🔐 Rotate 2FA ({selectedRows.size})
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            ➕ Add Account
          </button>
        </div>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-[1400px] mx-auto px-6 pb-8">

      {/* Stats */}
      <div className="flex gap-4 mt-6 mb-6 flex-wrap">
        {[
          { icon: '👥', value: accounts.length, label: 'Total Accounts' },
          { icon: '✅', value: totalChecked, label: 'Checked OK' },
          { icon: '💎', value: totalCredits.toLocaleString(), label: 'Total Credits' },
          { icon: '⚠️', value: accounts.filter(a => a.status?.startsWith('error')).length, label: 'Errors' },
        ].map(s => (
          <div key={s.label} className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-5 py-4 flex items-center gap-3 flex-1 min-w-[160px] backdrop-blur-sm transition-[border-color] duration-200 hover:border-white/15">
            <div className="text-[22px] w-10 h-10 bg-white/[0.04] rounded-lg flex items-center justify-center">{s.icon}</div>
            <div className="flex-1">
              <div className="text-[22px] font-bold text-slate-100">{s.value}</div>
              <div className="text-[11px] text-slate-600 uppercase tracking-[0.5px] mt-px">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden backdrop-blur-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] gap-3 flex-wrap">
          <span className="text-sm font-semibold text-slate-100">Accounts — {filtered.length} shown</span>
          <input
            className="search-input"
            placeholder="🔍 Search by email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-600">
            <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
            <div>Loading accounts...</div>
          </div>
        ) : error ? (
          <div className="px-6 py-10 text-center">
            <div className="text-danger mb-2 text-base">⚠️ {error}</div>
            <button className="btn btn-secondary" onClick={() => fetchAccounts()}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 px-5 text-slate-600">
            <div className="text-5xl mb-3">📭</div>
            <h3 className="text-base text-slate-400 mb-1.5">{search ? 'No matches found' : 'No accounts yet'}</h3>
            <p className="text-sm">{search ? 'Try a different search' : 'Add your first Google account to get started'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      title="Select all visible rows"
                      checked={filtered.length > 0 && filtered.every(a => selectedRows.has(a.id))}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedRows(prev => new Set([...prev, ...filtered.map(a => a.id)]));
                        } else {
                          setSelectedRows(prev => {
                            const next = new Set(prev);
                            filtered.forEach(a => next.delete(a.id));
                            return next;
                          });
                        }
                      }}
                    />
                  </th>
                  <th>#</th>
                  <th>Email</th>
                  {/* <th>Monthly Credits</th>
                  <th>Additional</th>
                  <th>Expiry</th> */}
                  <th>Members</th>
                  <th>Proxy</th>
                  <th>Last Checked</th>
                  <th>Status</th>
                  <th className="sticky right-0 bg-[#0a0d14]/95 backdrop-blur-md z-10 border-l border-white/[0.08] shadow-[-8px_0_15px_-3px_rgba(0,0,0,0.4)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account, idx) => (
                  <tr key={account.id} className={selectedRows.has(account.id) ? 'row-selected' : ''}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(account.id)}
                        onChange={e => {
                          setSelectedRows(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(account.id);
                            else next.delete(account.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="text-slate-600 text-xs">{idx + 1}</td>
                    <td className="email-cell">{account.email}</td>
                    {/* <td>
                      {account.monthlyCredits
                        ? <span className="credit-value">{parseInt(account.monthlyCredits.replace(/,/g, ''), 10).toLocaleString()}</span>
                        : <span className="credit-empty">–</span>}
                    </td>
                    <td>
                      {account.additionalCredits
                        ? <span className="credit-value text-accent2">{account.additionalCredits}</span>
                        : <span className="credit-empty">–</span>}
                    </td>
                    <td className="mono-cell text-[11px]">{account.additionalCreditsExpiry || '–'}</td> */}
                    <td>
                      {account.memberActivities && account.memberActivities.length > 0
                        ? <span className="text-[11px] text-slate-400 font-mono">{account.memberActivities.length} members</span>
                        : <span className="credit-empty">–</span>}
                    </td>
                    <td className="mono-cell text-[11px] max-w-[160px] break-all whitespace-normal" title={account.proxy || ''}>{account.proxy || '–'}</td>
                    <td className="mono-cell text-[11px]">{formatDate(account.lastChecked)}</td>
                    <td>{statusBadge(account.status)}</td>
                    <td className="sticky right-0 bg-[#0a0d14]/95 backdrop-blur-md z-10 border-l border-white/[0.08] shadow-[-8px_0_15px_-3px_rgba(0,0,0,0.4)]">
                      <div className="action-cell">
                        {account.status && account.status.startsWith('error') && (
                          <a
                            href={`/screenshots/${account.email.replace('@', '_at_')}.png`}
                            target="_blank" rel="noopener noreferrer"
                            className="btn btn-secondary btn-icon"
                            title="View Error Screenshot"
                            style={{ textDecoration: 'none' }}
                          >📸</a>
                        )}
                        <button className="btn btn-success" onClick={() => setCheckTarget(account)} title="Check credits">⚡ Check</button>
                        <button className="btn btn-secondary" onClick={() => setHistoryTarget(account)} title="View check history">📋 History</button>
                        <button className="btn btn-warning" onClick={() => setTwoFATarget(account)} title="Change 2FA secret">🔐 2FA</button>
                        <button
                          className="btn btn-secondary btn-icon"
                          onClick={() => handleResetProfile(account)}
                          disabled={resettingProfile === account.id}
                          title="Reset Chrome profile"
                        >
                          {resettingProfile === account.id ? <span className="spinner" /> : '🧹'}
                        </button>
                        <button
                          className="btn btn-danger btn-icon"
                          onClick={() => handleDelete(account)}
                          disabled={deletingRow === account.id}
                          title="Delete account"
                        >
                          {deletingRow === account.id ? <span className="spinner" /> : '🗑'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {checkTarget && (
        <CheckModal account={checkTarget} onClose={() => setCheckTarget(null)} onDone={() => fetchAccounts(true)} showToast={showToast} />
      )}
      {twoFATarget && (
        <Change2FAModal account={twoFATarget} onClose={() => setTwoFATarget(null)} onSaved={() => fetchAccounts(true)} showToast={showToast} />
      )}
      {showAddModal && (
        <AddAccountModal onClose={() => setShowAddModal(false)} onSaved={() => fetchAccounts(true)} />
      )}
      {showBulkCheck && accounts.length > 0 && (
        <BulkCheckModal accounts={accounts} onClose={() => setShowBulkCheck(false)} onDone={() => fetchAccounts(true)} />
      )}
      {showBulkCheckFailed && accounts.filter(a => a.status?.startsWith('error')).length > 0 && (
        <BulkCheckModal accounts={accounts.filter(a => a.status?.startsWith('error'))} onClose={() => setShowBulkCheckFailed(false)} onDone={() => fetchAccounts(true)} />
      )}
      {showBulkCheckPending && accounts.filter(a => !a.status || a.status === 'pending').length > 0 && (
        <BulkCheckModal accounts={accounts.filter(a => !a.status || a.status === 'pending')} onClose={() => setShowBulkCheckPending(false)} onDone={() => fetchAccounts(true)} />
      )}
      {showBulkCheckSelected && selectedRows.size > 0 && (
        <BulkCheckModal
          accounts={accounts.filter(a => selectedRows.has(a.id))}
          onClose={() => { setShowBulkCheckSelected(false); setSelectedRows(new Set()); }}
          onDone={() => { fetchAccounts(true); setSelectedRows(new Set()); }}
        />
      )}
      {showBulkChange2FA && selectedRows.size > 0 && (
        <BulkChange2FAModal
          accounts={accounts.filter(a => selectedRows.has(a.id))}
          onClose={() => { setShowBulkChange2FA(false); setSelectedRows(new Set()); }}
          onDone={() => { fetchAccounts(true); setSelectedRows(new Set()); }}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} showToast={showToast} />
      )}
      {historyTarget && (
        <CheckHistoryModal account={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
      {showSyncModal && (
        <SheetSyncStatusModal
          onClose={() => setShowSyncModal(false)}
          onDone={() => fetchAccounts(true)}
        />
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[200]">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' ? '✅' : '❌'} {t.message}
          </div>
        ))}
      </div>
      </div>{/* /content container */}
    </div>
  );
}
