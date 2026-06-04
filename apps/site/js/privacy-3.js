(function() {
  var sidebar = document.getElementById('sidebar-nav');
  if (!sidebar) return;

  var links = Array.prototype.slice.call(sidebar.querySelectorAll('a[href^="#"]'));
  var sections = links
    .map(function(link) {
      var target = document.querySelector(link.getAttribute('href'));
      return target ? { link: link, target: target } : null;
    })
    .filter(Boolean);

  if (!sections.length) return;

  function updateActiveSection() {
    var active = sections[0];
    var offset = 128;

    sections.forEach(function(item) {
      if (item.target.getBoundingClientRect().top <= offset) {
        active = item;
      }
    });

    links.forEach(function(link) {
      link.classList.toggle('active', link === active.link);
    });
  }

  updateActiveSection();
  window.addEventListener('scroll', updateActiveSection, { passive: true });
  window.addEventListener('resize', updateActiveSection);
})();
