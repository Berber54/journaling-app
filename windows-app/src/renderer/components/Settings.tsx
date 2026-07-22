import React, { useState, useEffect } from 'react';
import type { SyncStatus } from '../../shared/types';

interface SettingsProps {
  syncStatus: SyncStatus;
  onBack: () => void;
}

export default function Settings({ syncStatus, onBack }: SettingsProps) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authStatus, setAuthStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [authMessage, setAuthMessage] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);

  // Password change state (arbitrary characters, not just digits)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pinStatus, setPinStatus] = useState<'idle' | 'success' | 'error' | 'short'>('idle');

  // Windows Hello state
  const [bioOsAvailable, setBioOsAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(true);

  // OpenAI / AI assistant state
  const [openaiKey, setOpenaiKey] = useState('');
  const [keyStored, setKeyStored] = useState(false);
  const [aiModel, setAiModel] = useState('gpt-4o');
  const [aiSaved, setAiSaved] = useState(false);

  const AI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'];

  const MIN_PASSWORD_LENGTH = 6;

  useEffect(() => {
    // Load settings on mount
    const loadSettings = async () => {
      const url = await window.electronAPI.settingsGet('server_url');
      const user = await window.electronAPI.settingsGet('username');
      const configured = await window.electronAPI.authIsConfigured();
      if (url) setServerUrl(url);
      if (user) setUsername(user);
      setIsConfigured(configured);

      const osBio = await window.electronAPI.biometricAvailable();
      const pref = await window.electronAPI.settingsGet('biometric_enabled');
      setBioOsAvailable(osBio);
      setBioEnabled(pref !== 'false');

      const key = await window.electronAPI.settingsGet('openai_api_key');
      const model = await window.electronAPI.settingsGet('openai_model');
      setKeyStored(!!key);
      if (model) setAiModel(model);
    };
    loadSettings();
  }, []);

  const handleSaveAi = async () => {
    if (openaiKey.trim()) {
      await window.electronAPI.settingsSet('openai_api_key', openaiKey.trim());
      setKeyStored(true);
      setOpenaiKey('');
    }
    await window.electronAPI.settingsSet('openai_model', aiModel);
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  };

  const handleClearKey = async () => {
    await window.electronAPI.settingsSet('openai_api_key', '');
    setKeyStored(false);
  };

  const handleToggleBiometric = async () => {
    const next = !bioEnabled;
    setBioEnabled(next);
    await window.electronAPI.settingsSet('biometric_enabled', next ? 'true' : 'false');
  };

  const handleLogin = async () => {
    setAuthStatus('loading');
    try {
      await window.electronAPI.authLogin(serverUrl, username, password);
      setAuthStatus('success');
      setAuthMessage('Logged in successfully!');
      setIsConfigured(true);
    } catch (err: any) {
      setAuthStatus('error');
      setAuthMessage(err.message || 'Login failed');
    }
  };

  const handleRegister = async () => {
    setAuthStatus('loading');
    try {
      await window.electronAPI.authRegister(serverUrl, username, password);
      setAuthStatus('success');
      setAuthMessage('Account created and logged in!');
      setIsConfigured(true);
    } catch (err: any) {
      setAuthStatus('error');
      setAuthMessage(err.message || 'Registration failed');
    }
  };

  const handleSyncNow = async () => {
    await window.electronAPI.syncTrigger();
  };

  const handleChangePassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPinStatus('short');
      return;
    }
    const valid = await window.electronAPI.unlock(currentPassword);
    if (valid.success) {
      await window.electronAPI.setPin(newPassword);
      setPinStatus('success');
      setCurrentPassword('');
      setNewPassword('');
    } else {
      setPinStatus('error');
    }
  };

  return (
    <div className="editor-container" style={{ maxWidth: '560px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
        <button className="btn btn-secondary" onClick={onBack} style={{ padding: '6px 12px' }}>
          Back
        </button>
        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Settings</h2>
      </div>

      {/* Server Connection */}
      <section style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Server Connection
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            className="input"
            placeholder="Server URL (e.g., http://192.168.1.50:3377)"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
          <input
            className="input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={handleLogin} disabled={authStatus === 'loading'}>
              {authStatus === 'loading' ? 'Connecting...' : 'Login'}
            </button>
            <button className="btn btn-secondary" onClick={handleRegister} disabled={authStatus === 'loading'}>
              Register
            </button>
          </div>
          {authMessage && (
            <p style={{ fontSize: '13px', color: authStatus === 'success' ? 'var(--success)' : 'var(--danger)' }}>
              {authMessage}
            </p>
          )}
          {isConfigured && (
            <p style={{ fontSize: '13px', color: 'var(--success)' }}>Connected to server</p>
          )}
        </div>
      </section>

      {/* Sync */}
      <section style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Sync
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Status</span>
            <span style={{ color: syncStatus.online ? 'var(--success)' : 'var(--danger)' }}>
              {syncStatus.online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Last sync</span>
            <span>{syncStatus.lastSync ? new Date(syncStatus.lastSync).toLocaleString() : 'Never'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Pending entries</span>
            <span style={{ color: syncStatus.pendingCount > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
              {syncStatus.pendingCount}
            </span>
          </div>
          <button className="btn btn-secondary" onClick={handleSyncNow} disabled={syncStatus.syncing || !syncStatus.online}>
            {syncStatus.syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </section>

      {/* Security — fingerprint unlock */}
      {bioOsAvailable && (
        <section style={{ marginBottom: '32px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Security
          </h3>
          <button
            type="button"
            onClick={handleToggleBiometric}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '14px 16px', background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)', color: 'var(--text-primary)',
              cursor: 'pointer', textAlign: 'left', gap: '12px',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '14px', fontWeight: 500 }}>Unlock with fingerprint</span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Prompt the fingerprint sensor automatically on the lock screen
              </span>
            </span>
            <span className={`toggle ${bioEnabled ? 'on' : ''}`} aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </button>
        </section>
      )}

      {/* AI Assistant (OpenAI) */}
      <section style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          AI Assistant
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Connect an OpenAI API key to chat with an assistant about your journal. The key is
            stored locally on this device only and is sent only to OpenAI.
          </p>
          <input
            className="input"
            type="password"
            placeholder={keyStored ? '•••••••••• (key saved — enter a new key to replace)' : 'OpenAI API key (sk-...)'}
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
          />
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            Default model
            <select
              className="input"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
            >
              {AI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={handleSaveAi} disabled={!openaiKey.trim() && keyStored && !aiModel}>
              Save
            </button>
            {keyStored && (
              <button className="btn btn-secondary" onClick={handleClearKey}>
                Remove key
              </button>
            )}
          </div>
          {aiSaved && <p style={{ fontSize: '13px', color: 'var(--success)' }}>Saved</p>}
          {keyStored && !aiSaved && (
            <p style={{ fontSize: '13px', color: 'var(--success)' }}>API key is configured</p>
          )}
        </div>
      </section>

      {/* Change Password */}
      <section>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Change Password
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            className="input"
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); setPinStatus('idle'); }}
          />
          <input
            className="input"
            type="password"
            placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setPinStatus('idle'); }}
          />
          <button
            className="btn btn-secondary"
            onClick={handleChangePassword}
            disabled={currentPassword.length === 0 || newPassword.length < MIN_PASSWORD_LENGTH}
          >
            Update Password
          </button>
          {pinStatus === 'success' && (
            <p style={{ fontSize: '13px', color: 'var(--success)' }}>Password updated</p>
          )}
          {pinStatus === 'error' && (
            <p style={{ fontSize: '13px', color: 'var(--danger)' }}>Current password incorrect</p>
          )}
          {pinStatus === 'short' && (
            <p style={{ fontSize: '13px', color: 'var(--danger)' }}>New password must be at least {MIN_PASSWORD_LENGTH} characters</p>
          )}
        </div>
      </section>
    </div>
  );
}
