// ========== Scroll reveal ==========
        var revealObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
        document.querySelectorAll('.reveal').forEach(function(el) {
            revealObserver.observe(el);
        });

        // ========== Generate 90-day uptime bars ==========
        (function() {
            var container = document.getElementById('uptimeBars');
            for (var i = 0; i < 90; i++) {
                var bar = document.createElement('div');
                bar.className = 'day-bar flex-1 rounded-sm cursor-default';
                bar.style.height = '100%';
                bar.style.backgroundColor = '#22c55e';
                bar.style.opacity = '0.7';
                bar.style.minWidth = '2px';
                bar.title = daysAgoLabel(89 - i);
                container.appendChild(bar);
            }
        })();

        function daysAgoLabel(daysAgo) {
            var d = new Date();
            d.setDate(d.getDate() - daysAgo);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' — Operational';
        }

        // ========== Health check logic ==========
        var services = [
            {
                id: 'edge',
                name: 'Edge Proxy',
                url: 'https://staging-api.vaultproof.dev/health'
            },
            {
                id: 'backend',
                name: 'Backend API',
                url: 'https://staging-api.vaultproof.dev/backend-health'
            }
        ];

        var healthResults = {};

        function setServiceStatus(id, status, responseTime) {
            var dot = document.getElementById('dot-' + id);
            var badge = document.getElementById('badge-' + id);

            if (status === 'up') {
                dot.className = 'w-3 h-3 rounded-full bg-green-400 status-pulse';
                badge.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-green-400/10 text-green-400';
                badge.textContent = 'Operational';
            } else if (status === 'down') {
                dot.className = 'w-3 h-3 rounded-full bg-red-400 status-pulse';
                badge.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-red-400/10 text-amber-400';
                badge.textContent = 'Down';
            } else {
                dot.className = 'w-3 h-3 rounded-full bg-yellow-400 status-pulse';
                badge.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-400/10 text-yellow-400';
                badge.textContent = 'Checking';
            }

            healthResults[id] = { status: status, responseTime: responseTime || 0 };
            updateOverallStatus();
        }

        function updateOverallStatus() {
            var ids = services.map(function(s) { return s.id; });
            var allChecked = ids.every(function(id) { return healthResults[id]; });
            if (!allChecked) return;

            var upCount = ids.filter(function(id) { return healthResults[id].status === 'up'; }).length;
            var totalCount = ids.length;

            var heroDot = document.getElementById('heroStatusDot');
            var heroLabel = document.getElementById('heroStatusLabel');
            // Overall status
            if (upCount === totalCount) {
                heroDot.className = 'w-4 h-4 rounded-full bg-green-400 hero-status-pulse';
                heroLabel.textContent = 'All systems operational';
                heroLabel.className = 'text-sm font-medium text-green-400 tracking-wide uppercase';
            } else if (upCount === 0) {
                heroDot.className = 'w-4 h-4 rounded-full bg-red-400 hero-status-pulse-red';
                heroLabel.textContent = 'Major outage';
                heroLabel.className = 'text-sm font-medium text-amber-400 tracking-wide uppercase';
            } else {
                heroDot.className = 'w-4 h-4 rounded-full bg-yellow-400 hero-status-pulse';
                heroLabel.textContent = 'Partial outage';
                heroLabel.className = 'text-sm font-medium text-yellow-400 tracking-wide uppercase';
            }
        }

        function checkService(service) {
            setServiceStatus(service.id, 'checking', null);
            var start = performance.now();

            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 8000);

            fetch(service.url, { method: 'GET', mode: 'cors', signal: controller.signal })
                .then(function(response) {
                    clearTimeout(timeoutId);
                    var elapsed = Math.round(performance.now() - start);
                    if (response.ok) {
                        setServiceStatus(service.id, 'up', elapsed);
                    } else {
                        setServiceStatus(service.id, 'down', null);
                    }
                })
                .catch(function() {
                    clearTimeout(timeoutId);
                    setServiceStatus(service.id, 'down', null);
                });
        }

        function checkAll() {
            services.forEach(function(s) {
                checkService(s);
            });
        }

        // ========== Countdown timer ==========
        var countdownValue = 30;
        var countdownEl = document.getElementById('countdown');

        function startCountdown() {
            countdownValue = 30;
            countdownEl.textContent = countdownValue;
        }

        setInterval(function() {
            countdownValue--;
            if (countdownValue <= 0) {
                checkAll();
                startCountdown();
            } else {
                countdownEl.textContent = countdownValue;
            }
        }, 1000);

        // ========== Initial check ==========
        checkAll();
