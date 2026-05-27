// Nav shadow on scroll
        var mainNav = document.getElementById('mainNav');
        window.addEventListener('scroll', function() {
            if (window.scrollY > 10) {
                mainNav.classList.add('nav-scrolled');
            } else {
                mainNav.classList.remove('nav-scrolled');
            }
        });

        // Annual / Monthly pricing toggle
        var isAnnual = false;
        function toggleAnnual() {
            isAnnual = !isAnnual;
            var dot = document.getElementById('annualDot');
            var toggle = document.getElementById('annualToggle');
            if (isAnnual) {
                dot.style.left = '26px';
                dot.className = 'absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-sm';
                toggle.className = 'relative w-12 h-6 bg-vp-accent rounded-full transition-colors';
            } else {
                dot.style.left = '2px';
                dot.className = 'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-sm';
                toggle.className = 'relative w-12 h-6 bg-gray-200 rounded-full transition-colors';
            }
            document.querySelectorAll('[data-monthly]').forEach(function(el) {
                el.textContent = isAnnual ? el.getAttribute('data-annual') : el.getAttribute('data-monthly');
            });
            document.querySelectorAll('[data-period]').forEach(function(el) {
                el.textContent = isAnnual ? '/yr' : '/mo';
            });
        }

        // Scroll reveal with IntersectionObserver
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
            { cmd: 'vaultproof store --provider openai', delay: 40, output: [
                '<span class="text-gray-500">API Key: ••••••••••••••••••••••••</span>',
                '<span class="text-gray-500">Splitting key...</span>',
                '<span class="text-gray-500">Storing encrypted shares...</span>',
                '<span class="text-indigo-400">Key stored: vk_8f3a2b1c (openai)</span>',
                '<span class="text-gray-600">  Key was split locally. Full key is only assembled during API calls.</span>'
            ]},
            { cmd: 'vaultproof proxy --key vk_8f3a2b1c --path /v1/chat/completions --method POST --body \'{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}\'', delay: 30, output: [
                '<span class="text-gray-500">{"choices":[{"message":{"content":"Hello! How can I help you today?"}}]}</span>',
            ]},
            { cmd: 'vaultproof revoke vk_8f3a2b1c', delay: 40, output: [
                '<span class="text-gray-500">Are you sure you want to revoke key vk_8f3a2b1c? (y/N) y</span>',
                '<span class="text-indigo-400">Key vk_8f3a2b1c revoked.</span>'
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

        setTimeout(runTerminal, 800);

        // CTA email handler
        function handleCTA() {
            var email = document.getElementById('ctaEmail').value;
            if (email) {
                window.location.href = '/app/login?email=' + encodeURIComponent(email);
            } else {
                window.location.href = '/app/login';
            }
        }

        document.getElementById('ctaEmail').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleCTA();
        });

        // Preview split-key animation
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
