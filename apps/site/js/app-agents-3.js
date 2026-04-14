const token = localStorage.getItem('vaultproof_token');
    const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
    if (!token) { window.location.href = 'login'; }
    document.getElementById('sidebarEmail').textContent = user.email || '';
    document.getElementById('menuBtn').addEventListener('click', toggleMobileSidebar);

    function toggleMobileSidebar() {
      document.getElementById('sidebar').classList.toggle('-translate-x-full');
      document.getElementById('sidebarOverlay').classList.toggle('hidden');
    }

    async function logout() {
      Object.keys(localStorage).forEach(function(key) {
        if (key.startsWith('vaultproof_') || key.startsWith('sb-')) localStorage.removeItem(key);
      });
      sessionStorage.clear();
      window.location.href = 'login';
    }
