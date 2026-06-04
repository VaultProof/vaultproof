document.addEventListener('DOMContentLoaded', function() {
    var services = [
        { id: 'site', url: '/', label: 'Public site' },
        { id: 'dashboard', url: '/app/login', label: 'Dashboard shell' },
        { id: 'proxy', url: 'https://init.vaultproof.dev/health', label: 'Init and proxy edge' },
        { id: 'api', url: 'https://api.vaultproof.dev/health', label: 'API control plane' }
    ];

    var healthResults = {};
    var countdownValue = 30;
    var countdownEl = document.getElementById('countdown');

    function renderHistoryBars() {
        var container = document.getElementById('uptimeBars');
        if (!container) return;

        container.innerHTML = '';
        for (var i = 0; i < 90; i++) {
            var bar = document.createElement('span');
            bar.className = 'uptime-bar';
            bar.title = daysAgoLabel(89 - i);
            container.appendChild(bar);
        }
    }

    function daysAgoLabel(daysAgo) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - Operational';
    }

    function setStatusClass(el, baseClass, status) {
        if (!el) return;
        el.className = baseClass + ' ' + status;
    }

    function setServiceStatus(id, status, responseTime) {
        var dot = document.getElementById('dot-' + id);
        var badge = document.getElementById('badge-' + id);
        var latency = document.getElementById('latency-' + id);
        var card = document.querySelector('[data-service-card="' + id + '"]');

        setStatusClass(dot, 'status-dot', status);
        setStatusClass(badge, 'status-badge', status);
        if (card) card.dataset.status = status;

        if (badge) {
            if (status === 'operational') badge.textContent = 'Operational';
            else if (status === 'degraded') badge.textContent = 'Needs review';
            else badge.textContent = 'Checking';
        }

        if (latency) {
            latency.textContent = responseTime ? responseTime + ' ms' : '-- ms';
        }

        healthResults[id] = { status: status, responseTime: responseTime || 0 };
        updateOverallStatus();
    }

    function updateOverallStatus() {
        var allChecked = services.every(function(service) {
            return healthResults[service.id];
        });
        if (!allChecked) return;

        var operational = services.filter(function(service) {
            return healthResults[service.id].status === 'operational';
        }).length;
        var degraded = services.length - operational;

        var heroDot = document.getElementById('heroStatusDot');
        var heroLabel = document.getElementById('heroStatusLabel');
        var operationalCount = document.getElementById('operationalCount');
        var degradedCount = document.getElementById('degradedCount');

        if (operationalCount) operationalCount.textContent = String(operational);
        if (degradedCount) degradedCount.textContent = String(degraded);

        if (degraded === 0) {
            setStatusClass(heroDot, 'status-dot large', 'operational');
            if (heroLabel) heroLabel.textContent = 'All monitored services operational';
        } else if (operational === 0) {
            setStatusClass(heroDot, 'status-dot large', 'degraded');
            if (heroLabel) heroLabel.textContent = 'Major service issue';
        } else {
            setStatusClass(heroDot, 'status-dot large', 'checking');
            if (heroLabel) heroLabel.textContent = 'Some services need review';
        }
    }

    function checkService(service) {
        setServiceStatus(service.id, 'checking', null);

        var start = performance.now();
        var controller = new AbortController();
        var timeoutId = setTimeout(function() {
            controller.abort();
        }, 8000);

        fetch(service.url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal
        }).then(function(response) {
            clearTimeout(timeoutId);
            var elapsed = Math.max(1, Math.round(performance.now() - start));
            setServiceStatus(service.id, response.ok ? 'operational' : 'degraded', response.ok ? elapsed : null);
        }).catch(function() {
            clearTimeout(timeoutId);
            setServiceStatus(service.id, 'degraded', null);
        });
    }

    function checkAll() {
        services.forEach(checkService);
    }

    function resetCountdown() {
        countdownValue = 30;
        if (countdownEl) countdownEl.textContent = String(countdownValue);
    }

    function startCountdown() {
        resetCountdown();
        window.setInterval(function() {
            countdownValue -= 1;
            if (countdownValue <= 0) {
                checkAll();
                resetCountdown();
            } else if (countdownEl) {
                countdownEl.textContent = String(countdownValue);
            }
        }, 1000);
    }

    function setupSidebar() {
        var links = document.querySelectorAll('#sidebar-nav a[href^="#"]');
        if (!links.length) return;

        var sections = [];
        links.forEach(function(link) {
            var id = link.getAttribute('href')?.slice(1);
            if (!id) return;

            var el = document.getElementById(id);
            if (el) sections.push({ el: el, link: link });
        });

        function activate() {
            var current = sections[0];
            sections.forEach(function(section) {
                if (section.el.getBoundingClientRect().top <= 120) current = section;
            });

            links.forEach(function(link) {
                link.classList.remove('active');
            });

            if (current) current.link.classList.add('active');
        }

        window.addEventListener('scroll', activate, { passive: true });
        activate();
    }

    renderHistoryBars();
    setupSidebar();
    checkAll();
    startCountdown();
});
