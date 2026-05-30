(function() {
  var AUTH_HASH_STORAGE_KEY = 'vp_pending_auth_hash';
  var AUTH_CODE_STORAGE_KEY = 'vp_pending_auth_code';
  var isLoginPath = window.location.pathname.replace(/\/+$/, '') === '/app/login';
  var searchParams = new URLSearchParams(window.location.search || '');
  var code = searchParams.get('code');

  if (code) {
    var storedCode = false;
    try {
      sessionStorage.setItem(AUTH_CODE_STORAGE_KEY, code);
      storedCode = true;
    } catch {}

    if (storedCode) {
      searchParams.delete('code');
      var cleanQuery = searchParams.toString();
      var cleanUrl = (isLoginPath ? window.location.pathname : '/app/login') + (cleanQuery ? '?' + cleanQuery : '');
      if (isLoginPath) {
        window.history.replaceState({}, document.title, cleanUrl);
      } else {
        window.location.replace(cleanUrl);
      }
      return;
    }

    if (!isLoginPath) {
      window.location.replace('/app/login' + window.location.search);
      return;
    }
  }

  var hash = window.location.hash || '';
  if (!hash || hash.length < 2) return;

  var params = new URLSearchParams(hash.slice(1));
  var isAuthCallback = params.has('access_token') ||
    params.has('refresh_token') ||
    params.has('provider_token') ||
    params.has('error') ||
    params.get('type') === 'recovery' ||
    params.get('type') === 'magiclink';

  if (!isAuthCallback) return;

  var stored = false;
  try {
    sessionStorage.setItem(AUTH_HASH_STORAGE_KEY, hash.slice(1));
    stored = true;
  } catch {}

  if (isLoginPath) {
    if (stored) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
    return;
  }

  window.location.replace('/app/login' + window.location.search + (stored ? '' : hash));
})();
