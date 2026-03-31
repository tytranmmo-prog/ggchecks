'use client';

import { useState, useEffect, useCallback } from 'react';
import CheckModal from '@/components/CheckModal';
import Change2FAModal from '@/components/Change2FAModal';
import AddAccountModal from '@/components/AddAccountModal';
import BulkCheckModal from '@/components/BulkCheckModal';
import SettingsModal from '@/components/SettingsModal';

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
  const [showSettings, setShowSettings] = useState(false);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [resettingProfile, setResettingProfile] = useState<number | null>(null);
  const [resettingAll, setResettingAll] = useState(false);

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

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleDelete = async (account: Account) => {
    if (!confirm(`Delete account ${account.email}?`)) return;
    setDeletingRow(account.rowIndex);
    try {
      const res = await fetch('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex: account.rowIndex }),
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
    setResettingProfile(account.rowIndex);
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
    <div className="app-container">
      {/* Header */}
      <div className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">🤖</div>
          <div>
            <h1>GG Checks</h1>
            <p>Google AI Credit Manager</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => fetchAccounts(true)}
            disabled={refreshing}
            title="Refresh accounts"
          >
            <span className={refreshing ? 'spinning' : ''}>↻</span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
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
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            ➕ Add Account
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-info">
            <div className="stat-value">{accounts.length}</div>
            <div className="stat-label">Total Accounts</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-info">
            <div className="stat-value">{totalChecked}</div>
            <div className="stat-label">Checked OK</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💎</div>
          <div className="stat-info">
            <div className="stat-value">{totalCredits.toLocaleString()}</div>
            <div className="stat-label">Total Credits</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚠️</div>
          <div className="stat-info">
            <div className="stat-value">{accounts.filter(a => a.status?.startsWith('error')).length}</div>
            <div className="stat-label">Errors</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="table-card">
        <div className="table-toolbar">
          <span className="table-title">Accounts — {filtered.length} shown</span>
          <input
            className="search-input"
            placeholder="🔍 Search by email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
            <div>Loading accounts from Google Sheets...</div>
          </div>
        ) : error ? (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ color: 'var(--danger)', marginBottom: 8, fontSize: 16 }}>⚠️ {error}</div>
            <button className="btn btn-secondary" onClick={() => fetchAccounts()}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <h3>{search ? 'No matches found' : 'No accounts yet'}</h3>
            <p>{search ? 'Try a different search' : 'Add your first Google account to get started'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Email</th>
                  <th>Monthly Credits</th>
                  <th>Additional</th>
                  <th>Expiry</th>
                  <th>Members</th>
                  <th>Last Checked</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account, idx) => (
                  <tr key={account.rowIndex}>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                    <td className="email-cell">{account.email}</td>
                    <td>
                      {account.monthlyCredits
                        ? <span className="credit-value">{parseInt(account.monthlyCredits.replace(/,/g, ''), 10).toLocaleString()}</span>
                        : <span className="credit-empty">–</span>}
                    </td>
                    <td>
                      {account.additionalCredits
                        ? <span className="credit-value" style={{ color: 'var(--accent2)' }}>{account.additionalCredits}</span>
                        : <span className="credit-empty">–</span>}
                    </td>
                    <td className="mono-cell" style={{ fontSize: 11 }}>{account.additionalCreditsExpiry || '–'}</td>
                    <td>
                      {account.memberActivities
                        ? <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
                            {account.memberActivities.split(' | ').length} members
                          </span>
                        : <span className="credit-empty">–</span>}
                    </td>
                    <td className="mono-cell" style={{ fontSize: 11 }}>{formatDate(account.lastChecked)}</td>
                    <td>{statusBadge(account.status)}</td>
                    <td>
                      <div className="action-cell">
                        {account.status && account.status.startsWith('error') && (
                          <a
                            href={`/screenshots/${account.email.replace('@', '_at_')}.png`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary btn-icon"
                            title="View Error Screenshot"
                            style={{ textDecoration: 'none' }}
                          >
                            📸
                          </a>
                        )}
                        <button
                          className="btn btn-success"
                          onClick={() => setCheckTarget(account)}
                          title="Check credits"
                        >
                          ⚡ Check
                        </button>
                        <button
                          className="btn btn-warning"
                          onClick={() => setTwoFATarget(account)}
                          title="Change 2FA secret"
                        >
                          🔐 2FA
                        </button>
                        <button
                          className="btn btn-secondary btn-icon"
                          onClick={() => handleResetProfile(account)}
                          disabled={resettingProfile === account.rowIndex}
                          title="Reset Chrome profile — forces full re-login next check"
                        >
                          {resettingProfile === account.rowIndex ? <span className="spinner" /> : '🧹'}
                        </button>
                        <button
                          className="btn btn-danger btn-icon"
                          onClick={() => handleDelete(account)}
                          disabled={deletingRow === account.rowIndex}
                          title="Delete account"
                        >
                          {deletingRow === account.rowIndex ? <span className="spinner" /> : '🗑'}
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
        <CheckModal
          account={checkTarget}
          onClose={() => setCheckTarget(null)}
          onDone={() => fetchAccounts(true)}
          showToast={showToast}
        />
      )}

      {twoFATarget && (
        <Change2FAModal
          account={twoFATarget}
          onClose={() => setTwoFATarget(null)}
          onSaved={() => fetchAccounts(true)}
          showToast={showToast}
        />
      )}

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => fetchAccounts(true)}
        />
      )}

      {showBulkCheck && accounts.length > 0 && (
        <BulkCheckModal
          accounts={accounts}
          onClose={() => setShowBulkCheck(false)}
          onDone={() => fetchAccounts(true)}
        />
      )}

      {showBulkCheckFailed && accounts.filter(a => a.status?.startsWith('error')).length > 0 && (
        <BulkCheckModal
          accounts={accounts.filter(a => a.status?.startsWith('error'))}
          onClose={() => setShowBulkCheckFailed(false)}
          onDone={() => fetchAccounts(true)}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          showToast={showToast}
        />
      )}

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' ? '✅' : '❌'} {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
