(function() {
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
  const AUTH_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';

  let refreshPromise = null;

  function parseJson(value) {
    if (!value || typeof value !== 'string') return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function collectAuthField(value, field, results) {
    if (!value) return;
    if (typeof value === 'string') {
      const parsed = parseJson(value);
      if (parsed) collectAuthField(parsed, field, results);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectAuthField(item, field, results));
      return;
    }
    if (typeof value !== 'object') return;
    if (typeof value[field] === 'string' && value[field]) results.push(value[field]);
    if (field === 'user' && value[field] && typeof value[field] === 'object') results.push(value[field]);
    Object.keys(value).forEach((key) => collectAuthField(value[key], field, results));
  }

  function unique(values) {
    const seen = new Set();
    return values.filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function storageKeys() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function getSupabaseStorageValues() {
    const values = [];
    const direct = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (direct) values.push(direct);
    storageKeys().forEach((key) => {
      if ((key.startsWith('sb-') || key.includes('auth-token')) && key !== SUPABASE_AUTH_STORAGE_KEY) {
        const value = localStorage.getItem(key);
        if (value) values.push(value);
      }
    });
    return unique(values);
  }

  function getJwtExpiryMs(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return 0;
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)));
      return Number(payload.exp || 0) * 1000;
    } catch {
      return 0;
    }
  }

  function isUsableJwt(token) {
    const expiry = getJwtExpiryMs(token);
    if (!expiry) return Boolean(token);
    return expiry > Date.now() + 60000;
  }

  function getStoredFields(field) {
    const found = [];
    getSupabaseStorageValues().forEach((value) => collectAuthField(value, field, found));
    return unique(found);
  }

  function getAccessToken() {
    const explicit = localStorage.getItem('vaultproof_token') || '';
    const supabaseTokens = getStoredFields('access_token');
    const freshSupabase = supabaseTokens.find(isUsableJwt) || supabaseTokens[0] || '';
    const token = freshSupabase && !isUsableJwt(explicit) ? freshSupabase : (explicit || freshSupabase);
    if (token && token !== explicit) localStorage.setItem('vaultproof_token', token);
    return token || '';
  }

  function getRefreshTokens() {
    return unique([
      ...getStoredFields('refresh_token'),
      localStorage.getItem('vaultproof_refresh_token') || '',
    ]);
  }

  function hasRefreshToken() {
    return getRefreshTokens().length > 0;
  }

  function getUser() {
    const explicit = parseJson(localStorage.getItem('vaultproof_user') || '');
    if (explicit && (explicit.email || explicit.id)) return explicit;
    const userRecords = [];
    getSupabaseStorageValues().forEach((value) => collectAuthField(value, 'user', userRecords));
    const user = userRecords.find((item) => item && typeof item === 'object' && (item.email || item.id));
    return user || {};
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async function() {
      for (const refreshToken of getRefreshTokens()) {
        try {
          const res = await fetch(`${AUTH_API}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) continue;
          const data = await res.json().catch(() => null);
          if (!data || !data.token) continue;
          localStorage.setItem('vaultproof_token', data.token);
          if (data.refreshToken) localStorage.setItem('vaultproof_refresh_token', data.refreshToken);
          if (data.user) {
            localStorage.setItem('vaultproof_user', JSON.stringify({
              id: data.user.id || '',
              email: data.user.email || '',
            }));
          }
          return data.token;
        } catch {
          // Try the next stored refresh token before giving up.
        }
      }
      return '';
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  window.VaultProofSession = {
    getAccessToken,
    hasRefreshToken,
    getUser,
    refresh,
  };
})();
