(function() {
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
    document.addEventListener('DOMContentLoaded', bindCopyCommandButtons);
  } else {
    bindCopyCommandButtons();
  }
})();
