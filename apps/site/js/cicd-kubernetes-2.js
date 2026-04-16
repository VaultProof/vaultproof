(function () {
    var mobileToggle = document.getElementById('mobileToggle');
    var mobileMenu = document.getElementById('mobileMenu');
    if (mobileToggle && mobileMenu) {
        mobileToggle.addEventListener('click', function (event) {
            event.stopPropagation();
            mobileMenu.classList.toggle('open');
        });
    }

    var groups = document.querySelectorAll('.nav-group');
    function closeAll() {
        for (var i = 0; i < groups.length; i++) {
            groups[i].classList.remove('open');
            var btn = groups[i].querySelector('.nav-group-btn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
    }

    for (var i = 0; i < groups.length; i++) {
        (function (group) {
            var btn = group.querySelector('.nav-group-btn');
            if (!btn) return;
            btn.addEventListener('click', function (event) {
                event.stopPropagation();
                var isOpen = group.classList.contains('open');
                closeAll();
                if (!isOpen) {
                    group.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                }
            });
        })(groups[i]);
    }

    document.addEventListener('click', function (event) {
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].contains(event.target)) return;
        }
        closeAll();
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeAll();
    });
})();
