// Annual / Monthly pricing toggle
        let isAnnual = false;
        function toggleAnnual() {
          isAnnual = !isAnnual;
          const dot = document.getElementById('annualDot');
          const toggle = document.getElementById('annualToggle');
          if (isAnnual) {
            dot.style.left = '26px';
            dot.className = 'absolute top-0.5 w-5 h-5 bg-indigo-400 rounded-full transition-all';
            toggle.className = 'relative w-12 h-6 bg-indigo-500/30 rounded-full transition-colors';
          } else {
            dot.style.left = '2px';
            dot.className = 'absolute top-0.5 left-0.5 w-5 h-5 bg-gray-500 rounded-full transition-all';
            toggle.className = 'relative w-12 h-6 bg-[#1e1e2e] rounded-full transition-colors';
          }
          // Update price displays
          document.querySelectorAll('[data-monthly]').forEach(function(el) {
            el.textContent = isAnnual ? el.getAttribute('data-annual') : el.getAttribute('data-monthly');
          });
          document.querySelectorAll('[data-period]').forEach(function(el) {
            el.textContent = isAnnual ? '/yr' : '/mo';
          });
        }

        // Mobile menu toggle
        document.getElementById('mobileToggle').addEventListener('click', function() {
            document.getElementById('mobileMenu').classList.toggle('open');
        });

        // Nav dropdowns — click to open, click outside to close
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
                    if (!isOpen) {
                        group.classList.add('open');
                        btn.setAttribute('aria-expanded', 'true');
                    }
                });
            });

            // Close on click outside
            document.addEventListener('click', closeAll);

            // Close on Escape
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closeAll();
            });
        })();

        // Scroll reveal with IntersectionObserver
        const revealObserver = new IntersectionObserver(function(entries) {
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

        // Count-up animation for stats
        var countStarted = false;
        var statsObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting && !countStarted) {
                    countStarted = true;
                    document.querySelectorAll('.counter').forEach(function(counter) {
                        var target = parseFloat(counter.getAttribute('data-target'));
                        var suffix = counter.getAttribute('data-suffix') || '';
                        var decimals = parseInt(counter.getAttribute('data-decimals') || '0');
                        var duration = 2000;
                        var startTime = null;

                        function step(timestamp) {
                            if (!startTime) startTime = timestamp;
                            var progress = Math.min((timestamp - startTime) / duration, 1);
                            var eased = 1 - Math.pow(1 - progress, 3);
                            var current = (target * eased).toFixed(decimals);
                            counter.textContent = current + suffix;
                            if (progress < 1) {
                                requestAnimationFrame(step);
                            } else {
                                counter.textContent = (decimals > 0 ? target.toFixed(decimals) : target) + suffix;
                            }
                        }
                        requestAnimationFrame(step);
                    });
                }
            });
        }, { threshold: 0.3 });

        var statsBar = document.getElementById('statsBar');
        if (statsBar) statsObserver.observe(statsBar);

        // Terminal typing animation
        var terminalLines = [
            { cmd: 'npx @vaultproof/init', delay: 40, output: [
                '<span class="text-gray-500">Scanning .env...</span>',
                '<span class="text-gray-500">Found OPENAI_API_KEY, STRIPE_SECRET_KEY</span>',
                '<span class="text-gray-500">Storing and splitting keys...</span>',
                '<span class="text-indigo-400">Done. Your .env now uses one project ID.</span>',
                '<span class="text-gray-600">  VAULTPROOF_PROJECT_ID=vp_proj_8f3a2b1c</span>'
            ]},
            { cmd: 'npx @vaultproof/init --dry-run', delay: 40, output: [
                '<span class="text-gray-500">Scanning .env...</span>',
                '<span class="text-gray-500">Would replace OPENAI_API_KEY → proxy URL</span>',
                '<span class="text-gray-500">Would replace STRIPE_SECRET_KEY → proxy URL</span>',
                '<span class="text-indigo-400">Dry run complete. No files changed.</span>'
            ]}
        ];

        var termText = document.getElementById('terminalText');
        var termOutput = document.getElementById('terminalOutput');
        var termCursor = document.getElementById('terminalCursor');
        var currentLine = 0;

        function typeCommand(line, charIndex, callback) {
            if (charIndex < line.cmd.length) {
                termText.textContent += line.cmd[charIndex];
                setTimeout(function() { typeCommand(line, charIndex + 1, callback); }, line.delay);
            } else {
                setTimeout(callback, 400);
            }
        }

        function showOutput(lines, lineIndex, callback) {
            if (lineIndex < lines.length) {
                var div = document.createElement('div');
                div.innerHTML = lines[lineIndex];
                div.style.opacity = '0';
                termOutput.appendChild(div);
                requestAnimationFrame(function() {
                    div.style.transition = 'opacity 0.3s ease';
                    div.style.opacity = '1';
                });
                setTimeout(function() { showOutput(lines, lineIndex + 1, callback); }, 350);
            } else {
                setTimeout(callback, 2000);
            }
        }

        function runTerminal() {
            var line = terminalLines[currentLine];
            termText.textContent = '';
            termOutput.innerHTML = '';

            typeCommand(line, 0, function() {
                showOutput(line.output, 0, function() {
                    currentLine = (currentLine + 1) % terminalLines.length;
                    runTerminal();
                });
            });
        }

        // Start terminal after a short delay (only if hero terminal exists)
        if (termText) setTimeout(runTerminal, 800);

        // Draw connector lines from icons to terminal
        function drawHeroLines() {
            var svg = document.getElementById('heroLines');
            var container = document.getElementById('heroFlow');
            var terminal = document.getElementById('heroTerminal');
            if (!svg || !container || !terminal) return;

            var cRect = container.getBoundingClientRect();
            var tRect = terminal.getBoundingClientRect();
            svg.innerHTML = '';

            var ns = 'http://www.w3.org/2000/svg';
            var tTop = tRect.top - cRect.top;
            var tH = tRect.height;
            // Padding from terminal top/bottom edges
            var pad = tH * 0.15;

            function makePath(x1, y1, x2, y2, cls) {
                // Smooth bezier curve
                var mx = (x1 + x2) / 2;
                var d = 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
                var path = document.createElementNS(ns, 'path');
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'url(#lineGrad)');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('stroke-dasharray', '5 5');
                path.setAttribute('filter', 'url(#lineGlow)');
                path.classList.add(cls);
                svg.appendChild(path);
            }

            // Gradient + glow filter
            var defs = document.createElementNS(ns, 'defs');

            var grad = document.createElementNS(ns, 'linearGradient');
            grad.setAttribute('id', 'lineGrad');
            grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
            grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
            var stop1 = document.createElementNS(ns, 'stop');
            stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#a5b4fc'); stop1.setAttribute('stop-opacity', '0.1');
            var stop2 = document.createElementNS(ns, 'stop');
            stop2.setAttribute('offset', '50%'); stop2.setAttribute('stop-color', '#818cf8'); stop2.setAttribute('stop-opacity', '0.6');
            var stop3 = document.createElementNS(ns, 'stop');
            stop3.setAttribute('offset', '100%'); stop3.setAttribute('stop-color', '#a5b4fc'); stop3.setAttribute('stop-opacity', '0.1');
            grad.appendChild(stop1); grad.appendChild(stop2); grad.appendChild(stop3);
            defs.appendChild(grad);

            // Soft glow filter
            var filter = document.createElementNS(ns, 'filter');
            filter.setAttribute('id', 'lineGlow');
            filter.setAttribute('x', '-20%'); filter.setAttribute('y', '-20%');
            filter.setAttribute('width', '140%'); filter.setAttribute('height', '140%');
            var blur = document.createElementNS(ns, 'feGaussianBlur');
            blur.setAttribute('stdDeviation', '4');
            blur.setAttribute('result', 'glow');
            var merge = document.createElementNS(ns, 'feMerge');
            var mn1 = document.createElementNS(ns, 'feMergeNode'); mn1.setAttribute('in', 'glow');
            var mn2 = document.createElementNS(ns, 'feMergeNode'); mn2.setAttribute('in', 'SourceGraphic');
            merge.appendChild(mn1); merge.appendChild(mn2);
            filter.appendChild(blur); filter.appendChild(merge);
            defs.appendChild(filter);

            svg.appendChild(defs);

            // Left icons → spread along terminal left edge
            var leftIcons = document.querySelectorAll('.hero-left-icon');
            var lCount = leftIcons.length;
            leftIcons.forEach(function(icon, i) {
                var iRect = icon.getBoundingClientRect();
                var x1 = iRect.right - cRect.left;
                var y1 = iRect.top + iRect.height / 2 - cRect.top;
                var x2 = tRect.left - cRect.left;
                var y2 = tTop + pad + ((tH - pad * 2) / (lCount - 1)) * i;
                makePath(x1, y1, x2, y2, 'hero-line-left');
            });

            // Right icons → spread along terminal right edge
            var rightIcons = document.querySelectorAll('.hero-right-icon');
            var rCount = rightIcons.length;
            rightIcons.forEach(function(icon, i) {
                var iRect = icon.getBoundingClientRect();
                var x1 = tRect.right - cRect.left;
                var y1 = tTop + pad + ((tH - pad * 2) / (rCount - 1)) * i;
                var x2 = iRect.left - cRect.left;
                var y2 = iRect.top + iRect.height / 2 - cRect.top;
                makePath(x1, y1, x2, y2, 'hero-line-right');
            });
        }

        drawHeroLines();
        window.addEventListener('resize', drawHeroLines);

        // FAQ accordion (shadcn-style, single open)
        document.querySelectorAll('.faq-trigger').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var isOpen = btn.getAttribute('aria-expanded') === 'true';
                var content = btn.nextElementSibling;
                var accordion = btn.closest('.faq-accordion');

                // Close all others if single mode
                if (accordion && accordion.dataset.type === 'single') {
                    accordion.querySelectorAll('.faq-trigger').forEach(function(other) {
                        if (other !== btn) {
                            other.setAttribute('aria-expanded', 'false');
                            other.nextElementSibling.setAttribute('data-open', 'false');
                        }
                    });
                }

                btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
                content.setAttribute('data-open', isOpen ? 'false' : 'true');
            });
        });

        // Copy code button
        function copyCode() {
            var raw = document.getElementById('codeRaw').textContent;
            navigator.clipboard.writeText(raw).then(function() {
                var btn = document.getElementById('copyBtn');
                btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.3 4L6 11.3 2.7 8"/></svg> Copied!';
                btn.classList.add('text-green-400');
                setTimeout(function() {
                    btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 9V3a1.5 1.5 0 011.5-1.5H9"/></svg> Copy';
                    btn.classList.remove('text-green-400');
                }, 2000);
            });
        }

        // CTA email handler
        async function handleCTA() {
            var email = document.getElementById('ctaEmail').value.trim();
            var btn = document.getElementById('ctaBtn');
            if (!email) {
                window.location.href = '/app/login';
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Saving...';
            try {
                var res = await fetch('https://staging-api.vaultproof.dev/api/waitlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email })
                });
                if (res.ok) {
                    btn.textContent = "You're on the list!";
                    document.getElementById('ctaEmail').value = '';
                } else {
                    window.location.href = '/app/login?email=' + encodeURIComponent(email);
                }
            } catch (e) {
                window.location.href = '/app/login?email=' + encodeURIComponent(email);
            }
        }

        // Enter key for CTA input
        document.getElementById('ctaEmail').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleCTA();
        });

        // Demo split-key animation (runs in browser only)
        var DEMO_EXP = new Uint8Array(256);
        var DEMO_LOG = new Uint8Array(256);
        (function() {
            var x = 1;
            for (var i = 0; i < 256; i++) {
                DEMO_EXP[i] = x;
                DEMO_LOG[x] = i;
                x = x ^ (x << 1);
                if (x >= 256) x ^= 0x11d;
            }
            DEMO_LOG[0] = 0;
        })();

        function runDemo() {
            var input = document.getElementById('demoInput').value;
            var output = document.getElementById('demoOutput');
            if (!input || input.length < 3) { output.classList.add('hidden'); return; }
            output.classList.remove('hidden');

            var encoder = new TextEncoder();
            var bytes = encoder.encode(input);
            var share1 = [];
            var share2 = [];

            for (var i = 0; i < bytes.length; i++) {
                var rand = crypto.getRandomValues(new Uint8Array(1))[0];
                share1.push(rand);
                share2.push(bytes[i] ^ rand);
            }

            document.getElementById('demoShare1').textContent = btoa(String.fromCharCode.apply(null, share1));
            document.getElementById('demoShare2').textContent = btoa(String.fromCharCode.apply(null, share2));
        }

        // Close mobile menu on anchor click
        document.querySelectorAll('#mobileMenu a').forEach(function(link) {
            link.addEventListener('click', function() {
                document.getElementById('mobileMenu').classList.remove('open');
            });
        });
