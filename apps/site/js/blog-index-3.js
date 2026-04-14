document.getElementById('mobileToggle').addEventListener('click', function() {
    document.getElementById('mobileMenu').classList.toggle('open');
  });
  (function() {
    var groups = document.querySelectorAll('.nav-group');
    function closeAll() {
      groups.forEach(function(g) {
        g.classList.remove('open');
        var btn = g.querySelector('.nav-group-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
    }
    groups.forEach(function(group) {
      var btn = group.querySelector('.nav-group-btn');
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var isOpen = group.classList.contains('open');
        closeAll();
        if (!isOpen) { group.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAll(); });
  })();
