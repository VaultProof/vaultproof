(function () {
  var mobileToggle = document.getElementById('mobileToggle');
  var mobileMenu = document.getElementById('mobileMenu');
  if (!mobileToggle || !mobileMenu) return;

  mobileToggle.addEventListener('click', function (event) {
    event.stopPropagation();
    var isOpen = mobileMenu.classList.toggle('open');
    mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    mobileToggle.textContent = isOpen ? 'close' : 'menu';
  });

  mobileMenu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      mobileMenu.classList.remove('open');
      mobileToggle.setAttribute('aria-expanded', 'false');
      mobileToggle.textContent = 'menu';
    });
  });
})();
