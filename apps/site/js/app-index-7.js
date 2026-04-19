(function() {
  function signOut() {
    Object.keys(localStorage).forEach(function(key) {
      if (key.startsWith('vaultproof_') || key.startsWith('sb-') || key.includes('auth-token')) {
        localStorage.removeItem(key);
      }
    });
    sessionStorage.clear();
    window.location.replace('/app/login?logout=1');
  }

  function bindSignOut() {
    var signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSignOut);
  } else {
    bindSignOut();
  }
})();
