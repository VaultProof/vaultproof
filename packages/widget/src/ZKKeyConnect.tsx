import { useState, useCallback } from 'react';
import { VaultClient, type StoredKeyInfo } from './vault-client.js';
import { PROVIDERS, type Provider, type WidgetStatus, type ZKKeyConnectProps } from './types.js';

const DEFAULT_PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'together'];

const SHARE2_STORAGE_PREFIX = 'zkvault_share2_';

export function ZKKeyConnect({
  vaultUrl,
  appId,
  appName,
  userId,
  providers = DEFAULT_PROVIDERS,
  onSuccess,
  onError,
  theme = 'light',
}: ZKKeyConnectProps) {
  const [selectedProvider, setSelectedProvider] = useState<Provider>(providers[0]);
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<WidgetStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const isDark = theme === 'dark';

  const handleSubmit = useCallback(async () => {
    if (!apiKey.trim()) {
      setErrorMsg('Please enter an API key');
      return;
    }

    setStatus('splitting');
    setErrorMsg('');

    try {
      const client = new VaultClient({ vaultUrl, appId, appName });

      setStatus('storing');
      const keyInfo: StoredKeyInfo = await client.storeKey(
        userId,
        apiKey.trim(),
        selectedProvider,
        label || undefined
      );

      // Store Share 2 on device
      try {
        localStorage.setItem(
          `${SHARE2_STORAGE_PREFIX}${keyInfo.keySlotId}`,
          JSON.stringify({
            share2: keyInfo.share2,
            provider: keyInfo.provider,
            label: keyInfo.label,
            storedAt: new Date().toISOString(),
          })
        );
      } catch {
        // localStorage may not be available (iframe, SSR)
      }

      setStatus('success');
      setApiKey(''); // Clear key from memory immediately
      onSuccess?.(keyInfo.keySlotId, keyInfo.provider);
    } catch (err: any) {
      setStatus('error');
      const msg = err.message || 'Failed to store key';
      setErrorMsg(msg);
      onError?.(msg);
    }
  }, [apiKey, selectedProvider, label, vaultUrl, appId, appName, userId, onSuccess, onError]);

  const providerInfo = PROVIDERS[selectedProvider];

  return (
    <div style={styles.container(isDark)}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.shield}>&#128274;</div>
        <div>
          <div style={styles.title(isDark)}>Connect API Key</div>
          <div style={styles.subtitle(isDark)}>
            Your key is split instantly. {appName} never sees it.
          </div>
        </div>
      </div>

      {status === 'success' ? (
        <div style={styles.successBox}>
          <div style={styles.successIcon}>&#10003;</div>
          <div style={styles.successText}>
            Key securely stored! Your {PROVIDERS[selectedProvider].name} key has been
            split and vaulted.
          </div>
          <button
            style={styles.button(isDark)}
            onClick={() => {
              setStatus('idle');
              setLabel('');
            }}
          >
            Add Another Key
          </button>
        </div>
      ) : (
        <>
          {/* Provider selector */}
          <div style={styles.fieldGroup}>
            <label style={styles.label(isDark)}>Provider</label>
            <div style={styles.providerGrid}>
              {providers.map((p) => (
                <button
                  key={p}
                  style={{
                    ...styles.providerBtn(isDark),
                    ...(selectedProvider === p ? styles.providerBtnActive : {}),
                  }}
                  onClick={() => setSelectedProvider(p)}
                >
                  {PROVIDERS[p].name}
                </button>
              ))}
            </div>
          </div>

          {/* API Key input */}
          <div style={styles.fieldGroup}>
            <label style={styles.label(isDark)}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={providerInfo.placeholder}
              style={styles.input(isDark)}
              autoComplete="off"
              spellCheck={false}
            />
            {providerInfo.docsUrl && (
              <a
                href={providerInfo.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.docsLink}
              >
                Get a {providerInfo.name} key &#8594;
              </a>
            )}
          </div>

          {/* Label (optional) */}
          <div style={styles.fieldGroup}>
            <label style={styles.label(isDark)}>
              Label <span style={styles.optional}>(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`e.g., "Production" or "Testing"`}
              style={styles.input(isDark)}
            />
          </div>

          {/* Error */}
          {errorMsg && <div style={styles.error}>{errorMsg}</div>}

          {/* Submit */}
          <button
            style={{
              ...styles.button(isDark),
              opacity: status === 'splitting' || status === 'storing' ? 0.7 : 1,
            }}
            onClick={handleSubmit}
            disabled={status === 'splitting' || status === 'storing'}
          >
            {status === 'splitting'
              ? 'Splitting key...'
              : status === 'storing'
                ? 'Storing securely...'
                : 'Store Key Securely'}
          </button>

          {/* Security badge */}
          <div style={styles.securityBadge(isDark)}>
            &#128273; Shamir split &middot; Zero-knowledge proof &middot; Key never sent whole
          </div>
        </>
      )}
    </div>
  );
}

// --- Inline styles (no CSS dependency for easy embedding) ---

const styles = {
  container: (dark: boolean): React.CSSProperties => ({
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: 420,
    padding: 24,
    borderRadius: 16,
    border: `1px solid ${dark ? '#333' : '#e2e8f0'}`,
    backgroundColor: dark ? '#1a1a2e' : '#ffffff',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  }),
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  shield: {
    fontSize: 28,
  } as React.CSSProperties,
  title: (dark: boolean): React.CSSProperties => ({
    fontSize: 18,
    fontWeight: 700,
    color: dark ? '#e2e8f0' : '#1a202c',
  }),
  subtitle: (dark: boolean): React.CSSProperties => ({
    fontSize: 13,
    color: dark ? '#94a3b8' : '#64748b',
    marginTop: 2,
  }),
  fieldGroup: {
    marginBottom: 16,
  } as React.CSSProperties,
  label: (dark: boolean): React.CSSProperties => ({
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: dark ? '#cbd5e1' : '#374151',
    marginBottom: 6,
  }),
  optional: {
    fontWeight: 400,
    color: '#94a3b8',
  } as React.CSSProperties,
  providerGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  } as React.CSSProperties,
  providerBtn: (dark: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    borderRadius: 8,
    border: `1px solid ${dark ? '#333' : '#e2e8f0'}`,
    backgroundColor: dark ? '#16213e' : '#f8fafc',
    color: dark ? '#94a3b8' : '#64748b',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  }),
  providerBtnActive: {
    borderColor: '#6366f1',
    backgroundColor: '#eef2ff',
    color: '#4f46e5',
  } as React.CSSProperties,
  input: (dark: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${dark ? '#333' : '#e2e8f0'}`,
    backgroundColor: dark ? '#16213e' : '#f8fafc',
    color: dark ? '#e2e8f0' : '#1a202c',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  }),
  docsLink: {
    display: 'inline-block',
    marginTop: 6,
    fontSize: 12,
    color: '#6366f1',
    textDecoration: 'none',
  } as React.CSSProperties,
  error: {
    padding: '10px 12px',
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 16,
  } as React.CSSProperties,
  button: (dark: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: 'none',
    backgroundColor: '#6366f1',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  }),
  successBox: {
    textAlign: 'center',
    padding: '20px 0',
  } as React.CSSProperties,
  successIcon: {
    fontSize: 48,
    color: '#10b981',
    marginBottom: 12,
  } as React.CSSProperties,
  successText: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 16,
  } as React.CSSProperties,
  securityBadge: (dark: boolean): React.CSSProperties => ({
    marginTop: 16,
    textAlign: 'center',
    fontSize: 11,
    color: dark ? '#64748b' : '#94a3b8',
  }),
};
