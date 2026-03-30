'use client';

import { useState, useEffect } from 'react';

interface Props {
  onClose: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  hint?: string;
}

interface SectionDef {
  title: string;
  icon: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    title: 'General',
    icon: '⚙️',
    fields: [
      {
        key: 'BULK_CONCURRENCY',
        label: 'Bulk Concurrency (Slots)',
        type: 'number',
        placeholder: 'e.g. 4',
        hint: 'Max simultaneous browser sessions during bulk check.',
      },
    ],
  },
  {
    title: 'Proxy (Oxylabs)',
    icon: '🌐',
    fields: [
      {
        key: 'OXYLABS_PROXY_HOST',
        label: 'Proxy Host',
        placeholder: 'e.g. isp.oxylabs.io',
      },
      {
        key: 'OXYLABS_PROXY_USER',
        label: 'Proxy Username',
        placeholder: 'e.g. proxyvip_XXXXX',
      },
      {
        key: 'OXYLABS_PROXY_PASS',
        label: 'Proxy Password',
        type: 'password',
        placeholder: '••••••••',
      },
      {
        key: 'OXYLABS_BASE_PORT',
        label: 'Upstream Base Port',
        type: 'number',
        placeholder: 'e.g. 8001',
        hint: 'First upstream proxy port; slots cycle through OXYLABS_PORT_RANGE ports from here.',
      },
      {
        key: 'OXYLABS_PORT_RANGE',
        label: 'Port Range',
        type: 'number',
        placeholder: 'e.g. 99',
        hint: 'Number of upstream proxy ports to rotate across.',
      },
    ],
  },
  {
    title: 'Google Sheets / Drive',
    icon: '📊',
    fields: [
      {
        key: 'GOOGLE_SHEET_ID',
        label: 'Google Sheet ID',
        placeholder: 'Spreadsheet ID from the URL',
      },
      {
        key: 'DRIVE_SCREENSHOT_FOLDER_ID',
        label: 'Drive Screenshot Folder ID',
        placeholder: 'Google Drive folder ID for screenshots',
      },
      {
        key: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        label: 'Service Account Email',
        placeholder: 'e.g. service@project.iam.gserviceaccount.com',
        hint: 'Leave blank if already set in .env.local',
      },
      {
        key: 'GOOGLE_DELEGATED_SUBJECT',
        label: 'Delegated Subject (optional)',
        placeholder: 'e.g. user@yourdomain.com',
        hint: 'Domain-wide delegation subject. Leave blank if not used.',
      },
    ],
  },
  {
    title: 'Browser / GPMLogin',
    icon: '🖥️',
    fields: [
      {
        key: 'GPM_BASE_URL',
        label: 'GPMLogin API URL',
        placeholder: 'e.g. http://127.0.0.1:19995',
        hint: 'Local GPMLogin Global server base URL.',
      },
      {
        key: 'CHROME_PATH',
        label: 'Chrome Binary Path',
        placeholder: 'Leave blank to auto-detect',
        hint: 'Full path to Chrome/Chromium executable. Auto-detected by platform if empty.',
      },
      {
        key: 'BULK_BASE_PORT',
        label: 'CDP Base Port',
        type: 'number',
        placeholder: 'e.g. 9300',
        hint: 'First remote-debugging port; each slot gets baseCdpPort + slotIndex.',
      },
      {
        key: 'BULK_BASE_PROXY_PORT',
        label: 'Local Proxy Base Port',
        type: 'number',
        placeholder: 'e.g. 10100',
        hint: 'First local proxy listener port (ephemeral / persistent pools).',
      },
      {
        key: 'BULK_PROFILE_DIR',
        label: 'Profile Directory',
        placeholder: 'e.g. /tmp/ggchecks-profiles',
        hint: 'Root directory where Chrome profile folders are stored.',
      },
    ],
  },
  {
    title: 'Scripts',
    icon: '📜',
    fields: [
      {
        key: 'CHECKER_PATH',
        label: 'Checker Script Path',
        placeholder: 'e.g. ./checkOne.ts',
        hint: 'Absolute or project-relative path to the account-checker script.',
      },
      {
        key: 'CHANGE2FA_PATH',
        label: '2FA Rotation Script Path',
        placeholder: 'e.g. ./change2fa.ts',
        hint: 'Absolute or project-relative path to the 2FA rotation script.',
      },
    ],
  },
];

export default function SettingsModal({ onClose, showToast }: Props) {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.config) setConfig(data.config);
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
        body: JSON.stringify({ updates: config }),
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

  const togglePassword = (key: string) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="modal-overlay" onClick={e => !saving && e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg settings-modal">
        <div className="modal-header">
          <h2>⚙️ Runtime Configuration</h2>
          <button className="btn btn-secondary btn-icon" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <div className="modal-body settings-modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <span className="spinner" />
              <div style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading...</div>
            </div>
          ) : (
            <div className="settings-sections">
              {SECTIONS.map(section => (
                <div key={section.title} className="settings-section">
                  <div className="settings-section-header">
                    <span className="settings-section-icon">{section.icon}</span>
                    <h3 className="settings-section-title">{section.title}</h3>
                  </div>
                  <div className="settings-section-body">
                    {section.fields.map(field => (
                      <div key={field.key} className="settings-field">
                        <label className="form-label" htmlFor={`cfg-${field.key}`}>
                          {field.label}
                          <span className="settings-field-key">{field.key}</span>
                        </label>
                        <div className="settings-input-wrap">
                          <input
                            id={`cfg-${field.key}`}
                            type={
                              field.type === 'password'
                                ? showPasswords[field.key] ? 'text' : 'password'
                                : field.type || 'text'
                            }
                            className="form-input"
                            value={config[field.key] ?? ''}
                            onChange={e => handleChange(field.key, e.target.value)}
                            placeholder={field.placeholder}
                          />
                          {field.type === 'password' && (
                            <button
                              type="button"
                              className="settings-toggle-pass btn btn-secondary btn-icon"
                              onClick={() => togglePassword(field.key)}
                              title={showPasswords[field.key] ? 'Hide' : 'Show'}
                            >
                              {showPasswords[field.key] ? '🙈' : '👁️'}
                            </button>
                          )}
                        </div>
                        {field.hint && (
                          <p className="settings-field-hint">{field.hint}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
