'use client';

import { useState, useEffect } from 'react';

interface Props {
  onClose: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export default function SettingsModal({ onClose, showToast }: Props) {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.config) {
          setConfig(data.config);
        }
      })
      .catch(() => showToast('Failed to load configuration', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: config })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Configuration saved successfully', 'success');
      onClose();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="modal-overlay" onClick={(e) => !saving && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2>⚙️ Runtime Configuration</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <span className="spinner" />
              <div style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading...</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Bulk Concurrency (Slots)</label>
                <input
                  type="number"
                  className="form-input"
                  value={config['BULK_CONCURRENCY'] || ''}
                  onChange={e => handleChange('BULK_CONCURRENCY', e.target.value)}
                  placeholder="e.g. 4"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Proxy Host</label>
                <input
                  type="text"
                  className="form-input"
                  value={config['OXYLABS_PROXY_HOST'] || ''}
                  onChange={e => handleChange('OXYLABS_PROXY_HOST', e.target.value)}
                  placeholder="e.g. isp.oxylabs.io"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Proxy Username</label>
                <input
                  type="text"
                  className="form-input"
                  value={config['OXYLABS_PROXY_USER'] || ''}
                  onChange={e => handleChange('OXYLABS_PROXY_USER', e.target.value)}
                  placeholder="Proxy Username"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Proxy Password</label>
                <input
                  type="text"
                  className="form-input"
                  value={config['OXYLABS_PROXY_PASS'] || ''}
                  onChange={e => handleChange('OXYLABS_PROXY_PASS', e.target.value)}
                  placeholder="Proxy Password"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Google Sheet ID</label>
                <input
                  type="text"
                  className="form-input"
                  value={config['GOOGLE_SHEET_ID'] || ''}
                  onChange={e => handleChange('GOOGLE_SHEET_ID', e.target.value)}
                  placeholder="Google Sheet ID"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Drive Screenshot Folder ID</label>
                <input
                  type="text"
                  className="form-input"
                  value={config['DRIVE_SCREENSHOT_FOLDER_ID'] || ''}
                  onChange={e => handleChange('DRIVE_SCREENSHOT_FOLDER_ID', e.target.value)}
                  placeholder="Drive Folder ID"
                />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving...' : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
