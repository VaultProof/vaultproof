document.addEventListener('DOMContentLoaded', function() {
  var mobileToggle = document.getElementById('mobileToggle');
  var mobileMenu = document.getElementById('mobileMenu');

  if (!mobileToggle || !mobileMenu) return;

  mobileToggle.addEventListener('click', function() {
    var isOpen = mobileMenu.classList.toggle('open');
    mobileToggle.setAttribute('aria-expanded', String(isOpen));
  });

  mobileMenu.addEventListener('click', function(event) {
    if (event.target && event.target.tagName === 'A') {
      mobileMenu.classList.remove('open');
      mobileToggle.setAttribute('aria-expanded', 'false');
    }
  });
});
