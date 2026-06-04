document.addEventListener('DOMContentLoaded', function() {
    var links = document.querySelectorAll('#sidebar-nav a[href^="#"]');
    if (!links.length) return;

    var sections = [];
    links.forEach(function(link) {
        var id = link.getAttribute('href')?.slice(1);
        if (!id) return;

        var el = document.getElementById(id);
        if (el) sections.push({ el: el, link: link });
    });

    function activateSidebarLink() {
        var current = sections[0];
        sections.forEach(function(section) {
            if (section.el.getBoundingClientRect().top <= 120) current = section;
        });

        links.forEach(function(link) {
            link.classList.remove('active');
        });

        if (current) current.link.classList.add('active');
    }

    window.addEventListener('scroll', activateSidebarLink, { passive: true });
    activateSidebarLink();
});
