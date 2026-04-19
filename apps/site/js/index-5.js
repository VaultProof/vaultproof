(function() {
  function bindMobileMenu() {
    var toggle = document.getElementById('mobileToggle');
    var menu = document.getElementById('mobileMenu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', function() {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'close' : 'menu';
    });

    menu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'menu';
      });
    });
  }

  function bindCopyCommandButtons() {
    document.querySelectorAll('[data-copy-command]').forEach(function(button) {
      button.addEventListener('click', function() {
        var text = button.getAttribute('data-copy-command') || '';
        var hint = button.querySelector('.hero-cta-cmd-hint');
        if (!text || !hint) return;

        navigator.clipboard.writeText(text).catch(function() {});
        var originalHint = hint.textContent;
        hint.textContent = 'copied!';
        window.setTimeout(function() {
          hint.textContent = originalHint;
        }, 1500);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      bindMobileMenu();
      bindCopyCommandButtons();
    });
  } else {
    bindMobileMenu();
    bindCopyCommandButtons();
  }
})();
