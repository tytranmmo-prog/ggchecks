'use client';

import { useState } from 'react';

interface Props {
  account: { rowIndex: number; email: string; totpSecret: string };
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export default function Change2FAModal({ account, onClose, onSaved, showToast }: Props) {
  const [totpSecret, setTotpSecret] = useState(account.totpSecret);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!totpSecret.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/update-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex: account.rowIndex, totpSecret: totpSecret.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast('2FA secret updated ✓', 'success');
      onSaved();
      onClose();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>🔐 Change 2FA Secret</h2>
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
              value={totpSecret}
              onChange={e => setTotpSecret(e.target.value)}
              placeholder="e.g. JBSWY3DPEHPK3PXP"
              autoFocus
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            💡 This updates only the stored secret in the spreadsheet. The account&apos;s Google 2FA settings are unchanged.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-warning" onClick={handleSave} disabled={loading || !totpSecret.trim()}>
            {loading ? <><span className="spinner" /> Saving...</> : '🔐 Update Secret'}
          </button>
        </div>
      </div>
    </div>
  );
}
