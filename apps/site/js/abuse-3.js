(function() {
    function isLoggedIn() {
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                try {
                    var d = JSON.parse(localStorage.getItem(key));
                    if (d && d.access_token && d.expires_at > Date.now() / 1000) return true;
                } catch(e) {}
            }
        }
        return false;
    }
    if (isLoggedIn()) {
        document.querySelectorAll('.nav-dashboard').forEach(function(el) {
            el.style.display = '';
        });
    }
})();
