// ── Utilities ────────────────────────────────────────────────────────────
        function escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function parseRepo(raw) {
            // Accept: "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo"
            const s = raw.trim().replace(/\/+$/, '');
            const m = s.match(/(?:github\.com\/)?([a-zA-Z0-9_.\-]+\/[a-zA-Z0-9_.\-]+)/);
            return m ? m[1] : null;
        }

        function severityClass(severity) {
            const s = (severity || '').toUpperCase();
            if (s === 'CRITICAL') return 'badge-critical';
            if (s === 'HIGH')     return 'badge-high';
            if (s === 'MEDIUM')   return 'badge-medium';
            return 'badge-low';
        }

        // Provider icon SVGs keyed by lowercase provider name substring
        function providerIcon(provider) {
            const p = (provider || '').toLowerCase();
            if (p.includes('openai')) {
                return '<svg viewBox="0 0 24 24" fill="#fff" class="w-5 h-5"><path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 0011.756.004a6.047 6.047 0 00-5.77 4.087 6.06 6.06 0 00-4.076 2.932 6.052 6.052 0 00.747 7.098 5.98 5.98 0 00.51 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.18 23.997a6.043 6.043 0 005.77-4.089 6.045 6.045 0 004.078-2.931 6.045 6.045 0 00-.747-7.156zM13.18 22.178a4.507 4.507 0 01-2.89-1.05l.14-.08 4.8-2.77a.78.78 0 00.395-.678v-6.77l2.03 1.17a.07.07 0 01.038.052v5.6a4.52 4.52 0 01-4.513 4.526zm-9.7-4.15a4.5 4.5 0 01-.54-3.025l.14.084 4.8 2.77a.78.78 0 00.788 0l5.865-3.387v2.34a.07.07 0 01-.028.06l-4.857 2.806a4.52 4.52 0 01-6.168-1.648zM2.39 7.86a4.498 4.498 0 012.355-1.98V11.6a.78.78 0 00.392.676l5.865 3.387-2.03 1.172a.07.07 0 01-.066.006L4.047 14.03A4.52 4.52 0 012.39 7.872zm16.678 3.885l-5.865-3.387 2.03-1.172a.07.07 0 01.066-.006l4.857 2.806a4.517 4.517 0 01-.699 8.143V12.42a.78.78 0 00-.389-.676zm2.02-3.035l-.14-.085-4.8-2.77a.78.78 0 00-.788 0L9.496 9.242V6.9a.07.07 0 01.028-.06l4.857-2.805a4.516 4.516 0 016.707 4.675zm-12.7 4.18l-2.03-1.17a.07.07 0 01-.038-.052V6.07a4.517 4.517 0 017.402-3.467l-.14.08-4.8 2.77a.78.78 0 00-.393.677zm1.1-2.376l2.612-1.508 2.613 1.508v3.016l-2.613 1.508-2.612-1.508z"/></svg>';
            }
            if (p.includes('anthropic') || p.includes('claude')) {
                return '<svg viewBox="0 0 24 24" fill="#D4A574" class="w-5 h-5"><path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.508-4.064H5.248l-1.508 4.064H.166L6.57 3.52zm1.04 4.87L5.32 14.15h4.578L7.61 8.39z"/></svg>';
            }
            if (p.includes('stripe')) {
                return '<svg viewBox="0 0 24 24" fill="#635BFF" class="w-5 h-5"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/></svg>';
            }
            if (p.includes('aws') || p.includes('amazon')) {
                return '<svg viewBox="0 0 24 24" fill="#FF9900" class="w-5 h-5"><path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 01-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 01-.287-.375 6.18 6.18 0 01-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.295.072-.583.16-.862.272a2.287 2.287 0 01-.28.104.488.488 0 01-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 01.224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 011.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586zm-3.24 1.214c.263 0 .534-.048.822-.144.287-.096.543-.271.758-.51.128-.152.224-.32.272-.512.047-.191.08-.423.08-.694v-.335a6.66 6.66 0 00-.735-.136 6.02 6.02 0 00-.75-.048c-.535 0-.926.104-1.19.32-.263.215-.39.518-.39.917 0 .375.095.655.295.846.191.2.47.296.838.296zm6.41.862c-.144 0-.24-.024-.304-.08-.063-.048-.12-.16-.168-.311L7.586 5.55a1.398 1.398 0 01-.072-.32c0-.128.064-.2.191-.2h.783c.151 0 .255.025.31.08.065.048.113.16.16.312l1.342 5.284 1.245-5.284c.04-.16.088-.264.151-.312a.549.549 0 01.32-.08h.638c.152 0 .256.025.32.08.063.048.12.16.151.312l1.261 5.348 1.381-5.348c.048-.16.104-.264.16-.312a.52.52 0 01.311-.08h.743c.127 0 .2.065.2.2 0 .04-.009.08-.017.128a1.137 1.137 0 01-.056.2l-1.923 6.17c-.048.16-.104.263-.168.311a.51.51 0 01-.303.08h-.687c-.151 0-.255-.024-.32-.08-.063-.056-.119-.16-.15-.32l-1.238-5.148-1.23 5.14c-.04.16-.087.264-.15.32-.065.056-.177.08-.32.08zm10.256.215c-.415 0-.83-.048-1.229-.143-.399-.096-.71-.2-.918-.32-.128-.071-.215-.151-.247-.223a.563.563 0 01-.048-.224v-.407c0-.167.064-.247.183-.247.048 0 .096.008.144.024.048.016.12.048.2.08.271.12.566.215.878.279.319.064.63.096.95.096.502 0 .894-.088 1.165-.264a.86.86 0 00.415-.758.777.777 0 00-.215-.559c-.144-.151-.416-.287-.807-.415l-1.157-.36c-.583-.183-1.014-.454-1.277-.813a1.902 1.902 0 01-.4-1.158c0-.335.073-.63.216-.886.144-.255.335-.479.575-.654.24-.184.51-.32.83-.415.32-.096.655-.136 1.006-.136.175 0 .359.008.535.032.183.024.35.056.518.088.16.04.311.08.455.127.144.048.256.096.336.144a.69.69 0 01.24.2.43.43 0 01.071.263v.375c0 .168-.064.256-.184.256a.83.83 0 01-.303-.096 3.652 3.652 0 00-1.532-.311c-.455 0-.815.071-1.062.223-.248.152-.375.383-.375.71 0 .224.08.416.24.567.159.152.454.304.877.44l1.134.358c.574.184.99.44 1.237.767.247.327.367.702.367 1.117 0 .343-.072.655-.207.926-.144.272-.336.511-.583.703-.248.2-.543.343-.886.447-.36.111-.743.167-1.158.167zM21.73 13.23c-2.636 1.948-6.464 2.983-9.761 2.983-4.616 0-8.774-1.707-11.922-4.546-.247-.223-.025-.527.271-.351 3.4 1.978 7.601 3.163 11.943 3.163 2.927 0 6.15-.607 9.112-1.867.447-.191.822.295.357.618z"/><path d="M22.792 11.967c-.336-.43-2.22-.207-3.074-.103-.255.032-.295-.192-.063-.36 1.5-1.053 3.967-.75 4.254-.399.287.36-.08 2.826-1.485 4.007-.215.184-.423.088-.327-.151.318-.79 1.03-2.564.695-2.994z"/></svg>';
            }
            if (p.includes('google') || p.includes('gcp') || p.includes('gemini')) {
                return '<svg viewBox="0 0 24 24" class="w-5 h-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
            }
            if (p.includes('github')) {
                return '<svg viewBox="0 0 24 24" fill="#fff" class="w-5 h-5"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>';
            }
            // Generic key icon fallback
            return '<svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>';
        }

        // ── UI state helpers ─────────────────────────────────────────────────────
        function showProgress() {
            hide('errorBox');
            hide('resultsContainer');
            show('progressBox');
        }

        function hideProgress() { hide('progressBox'); }

        function showError(msg) {
            hide('progressBox');
            document.getElementById('errorMsg').textContent = msg;
            show('errorBox');
        }

        function show(id) { document.getElementById(id).classList.remove('hidden'); }
        function hide(id) { document.getElementById(id).classList.add('hidden'); }

        function setScanning(active) {
            const btn = document.getElementById('scanBtn');
            const input = document.getElementById('repoInput');
            btn.disabled = active;
            input.disabled = active;
            btn.textContent = active ? 'Scanning…' : '';
            if (!active) {
                btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Scan repo';
            }
        }

        // ── Render findings ──────────────────────────────────────────────────────
        function renderFindings(findings, repo) {
            const list = document.getElementById('findingsList');
            list.innerHTML = '';

            findings.forEach((f, i) => {
                const card = document.createElement('div');
                card.className = 'finding-card';
                card.style.animationDelay = (i * 60) + 'ms';

                const sevClass = severityClass(f.severity);
                const isHistory = f.source === 'history';

                // Safe escaped values for all user-derived fields
                const provider     = escapeHtml(f.providerName || f.provider || 'Unknown');
                const severity     = escapeHtml(f.severity || 'LOW');
                const filePath     = escapeHtml(f.file || f.path || '');
                const lineNum      = escapeHtml(String(f.line || f.line_number || ''));
                const maskedVal    = escapeHtml(f.maskedValue || f.masked_value || f.value || '');
                const commitSha    = f.commitSha ? escapeHtml(f.commitSha.slice(0, 7)) : '';
                const commitMsg    = f.commitMessage ? escapeHtml(f.commitMessage.slice(0, 60)) : '';
                const commitUrl    = commitSha ? `https://github.com/${escapeHtml(repo)}/commit/${escapeHtml(f.commitSha)}` : '';

                const historyBadge = isHistory
                    ? `<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400">📜 git history</span>`
                    : '';

                const commitLine = isHistory && commitSha
                    ? `<p class="text-xs text-gray-600 mt-1 font-mono">
                          <a href="${commitUrl}" target="_blank" rel="noopener" class="text-purple-500 hover:text-purple-400 underline underline-offset-2">${commitSha}</a>
                          ${commitMsg ? `<span class="text-gray-700"> — ${commitMsg}</span>` : ''}
                       </p>`
                    : '';

                card.innerHTML = `
                    <div class="finding-card-inner bg-vp-surface border border-vp-border rounded-xl px-4 py-4">
                        <div class="flex items-start gap-3">
                            <div class="w-9 h-9 rounded-lg bg-card border border-vp-border flex items-center justify-center flex-shrink-0 icon-slot"></div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap mb-1.5">
                                    <span class="text-sm font-semibold text-white">${provider}</span>
                                    <span class="text-xs font-medium px-2 py-0.5 rounded-full ${sevClass}">${severity}</span>
                                    ${historyBadge}
                                </div>
                                ${filePath ? `<p class="text-xs text-gray-500 font-mono truncate mb-0.5">
                                    <span class="text-gray-400">${filePath}</span>${lineNum ? `<span class="text-gray-600">:${lineNum}</span>` : ''}
                                </p>` : ''}
                                ${commitLine}
                                ${maskedVal ? `<p class="text-xs font-mono text-gray-600 truncate mt-1">${maskedVal}</p>` : ''}
                            </div>
                        </div>
                    </div>`;

                // Inject provider icon into its isolated slot — kept separate from
                // user-derived data so future changes to providerIcon() cannot
                // accidentally introduce XSS via API-derived field interpolation.
                const iconSlot = card.querySelector('.icon-slot');
                if (iconSlot) {
                    // providerIcon() returns only hardcoded static SVG strings — safe
                    iconSlot.innerHTML = providerIcon(f.provider || '');
                }

                list.appendChild(card);
            });
        }

        // ── Render risky files, code smells, recommendations ─────────────────────
        function renderExtraFindings(fileFindings, codeFindings, hygieneFindings) {
            // Remove any previous extra sections
            ['vpExtraFileSec','vpExtraCodeSec','vpExtraHygieneSec'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.remove();
            });

            var container = document.getElementById('resultsContainer');

            // Risky files section (HIGH)
            if (fileFindings.length > 0) {
                var fileHtml = '<div id="vpExtraFileSec" class="mt-6">' +
                    '<h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">' +
                    '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold">!</span>' +
                    'Risky files committed (' + fileFindings.length + ')</h2>' +
                    '<div class="space-y-2">' +
                    fileFindings.map(function(f) {
                        return '<div class="bg-vp-surface border border-orange-900/40 rounded-xl px-5 py-4">' +
                            '<div class="flex items-center gap-2 mb-1">' +
                            '<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400">HIGH</span>' +
                            '<span class="text-sm font-medium text-gray-200">' + escapeHtml(f.title || f.providerName || '') + '</span></div>' +
                            (f.file ? '<p class="text-xs text-gray-500 font-mono mb-1">' + escapeHtml(f.file) + '</p>' : '') +
                            '<p class="text-xs text-gray-400">' + escapeHtml(f.description || '') + '</p></div>';
                    }).join('') +
                    '</div></div>';
                container.insertAdjacentHTML('beforeend', fileHtml);
            }

            // Code smells section (MEDIUM)
            if (codeFindings.length > 0) {
                var shown = codeFindings.slice(0, 30);
                var codeHtml = '<div id="vpExtraCodeSec" class="mt-6">' +
                    '<h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">' +
                    '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">?</span>' +
                    'Code smells (' + codeFindings.length + ')</h2>' +
                    '<div class="space-y-2">' +
                    shown.map(function(f) {
                        return '<div class="bg-vp-surface border border-amber-900/30 rounded-xl px-4 py-3">' +
                            '<div class="flex items-center gap-2 mb-1">' +
                            '<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">MEDIUM</span>' +
                            '<span class="text-sm font-medium text-gray-300">' + escapeHtml(f.title || f.providerName || '') + '</span></div>' +
                            '<p class="text-xs text-gray-500 font-mono">' + escapeHtml(f.file || '') + ':' + (f.line || '') + '</p>' +
                            '<p class="text-xs text-gray-500 mt-1">' + escapeHtml(f.description || '') + '</p></div>';
                    }).join('') +
                    (codeFindings.length > 30 ? '<p class="text-xs text-gray-600 text-center mt-2">+ ' + (codeFindings.length - 30) + ' more — showing top 30</p>' : '') +
                    '</div></div>';
                container.insertAdjacentHTML('beforeend', codeHtml);
            }

            // Recommendations section (INFO) — always shown
            var hygieneHtml = '<div id="vpExtraHygieneSec" class="mt-6 mb-4">' +
                '<h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">' +
                '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">i</span>' +
                'Recommendations</h2>' +
                '<div class="bg-vp-surface border border-vp-border rounded-xl px-5 py-4">';
            if (hygieneFindings.length === 0) {
                hygieneHtml += '<p class="text-sm text-gray-400">Looks great — all hygiene checks passed.</p>';
            } else {
                hygieneHtml += '<ul class="space-y-3">' +
                    hygieneFindings.map(function(f) {
                        return '<li class="text-sm"><div class="text-gray-300 font-medium">' + escapeHtml(f.title || f.providerName || '') + '</div>' +
                            '<div class="text-xs text-gray-500 mt-0.5">' + escapeHtml(f.description || '') + '</div></li>';
                    }).join('') +
                    '</ul>';
            }
            hygieneHtml += '</div></div>';
            container.insertAdjacentHTML('beforeend', hygieneHtml);
        }

        // ── Progress bar ─────────────────────────────────────────────────────────
        function updateProgressBar(state) {
            var phaseEl = document.getElementById('progressPhase');
            var pctEl   = document.getElementById('progressPct');
            var fillEl  = document.getElementById('progressFill');
            if (!phaseEl) return;

            // Weighted progress: tree 5%, files 5→60%, commits 60→95%, done 100%
            var pct = 5;
            if (state.filesTotal > 0) pct += (state.filesDone / state.filesTotal) * 55;
            if (state.commitsTotal > 0) pct += (state.commitsDone / state.commitsTotal) * 35;
            pct = Math.min(pct, state.done ? 100 : 99);

            var phaseLabel = 'Starting scan…';
            if (state.done) {
                phaseLabel = 'Done';
            } else if (state.filesTotal > 0 && state.filesDone < state.filesTotal) {
                phaseLabel = 'Scanning files (' + state.filesDone + '/' + state.filesTotal + ')';
            } else if (state.commitsTotal > 0 && state.commitsDone < state.commitsTotal) {
                phaseLabel = 'Scanning git history (' + state.commitsDone + '/' + state.commitsTotal + ')';
            } else if (state.treeStarted) {
                phaseLabel = 'Fetching repo tree…';
            }

            phaseEl.textContent = phaseLabel;
            pctEl.textContent   = Math.round(pct) + '%';
            fillEl.style.width  = pct + '%';
        }

        // ── Main scan function ───────────────────────────────────────────────────
        async function runScan(rawRepo) {
            var repo = parseRepo(rawRepo);
            if (!repo) {
                showError('Please enter a valid GitHub repo (e.g. owner/repo or github.com/owner/repo).');
                return;
            }

            if (typeof gtag !== 'undefined') {
                gtag('event', 'public_scan_started', { repo: repo });
            }

            setScanning(true);
            hide('errorBox');
            hide('resultsContainer');
            hide('stickyBar');
            hide('whatWeScan');
            show('progressBox');

            var progressState = {
                treeStarted: false,
                filesDone: 0, filesTotal: 0,
                commitsDone: 0, commitsTotal: 0,
                done: false,
            };
            updateProgressBar(progressState);

            try {
                var res = await fetch('https://api.vaultproof.dev/api/scan/public', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo: repo })
                });

                if (!res.ok) {
                    var errData = {};
                    try { errData = await res.json(); } catch(e) {}
                    var errMsg;
                    switch (res.status) {
                        case 400: errMsg = 'Invalid repo — make sure it exists and is public.'; break;
                        case 403: errMsg = 'Access denied. The repo may be private or rate limited.'; break;
                        case 404: errMsg = 'Repo not found. Check the owner/repo slug and try again.'; break;
                        case 429: errMsg = 'Too many requests. Please wait a moment and try again.'; break;
                        case 500: errMsg = 'GitHub API error. Please try again in a moment.'; break;
                        case 504: errMsg = 'GitHub API timed out. Try again in a moment.'; break;
                        default:  errMsg = (errData && errData.error) ? escapeHtml(String(errData.error)) : 'Something went wrong. Please try again.';
                    }
                    hide('progressBox');
                    showError(errMsg);
                    setScanning(false);
                    return;
                }

                // Stream NDJSON line by line
                var reader = res.body.getReader();
                var decoder = new TextDecoder();
                var buf = '';
                var finalResult = null;

                while (true) {
                    var chunk = await reader.read();
                    if (chunk.done) break;
                    buf += decoder.decode(chunk.value, { stream: true });
                    var lines = buf.split('\n');
                    buf = lines.pop(); // keep incomplete last chunk
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (!line) continue;
                        var evt;
                        try { evt = JSON.parse(line); } catch(e) { continue; }
                        if (evt.phase === 'tree') {
                            progressState.treeStarted = true;
                        } else if (evt.phase === 'files') {
                            progressState.filesDone = evt.done;
                            progressState.filesTotal = evt.total;
                        } else if (evt.phase === 'commits') {
                            progressState.commitsDone = evt.done;
                            progressState.commitsTotal = evt.total;
                        } else if (evt.phase === 'done') {
                            progressState.done = true;
                            finalResult = evt.result;
                        } else if (evt.phase === 'error') {
                            throw new Error(evt.message || 'Scan failed');
                        }
                        updateProgressBar(progressState);
                    }
                }

                if (!finalResult) throw new Error('Scan ended without a result');

                // Brief pause so user sees 100% before results appear
                await new Promise(function(r) { setTimeout(r, 300); });

                hide('progressBox');
                setScanning(false);

                var data = finalResult;
                var findings       = Array.isArray(data.findings) ? data.findings : [];
                var filesScanned   = typeof data.filesScanned === 'number' ? data.filesScanned : null;
                var commitsScanned = typeof data.commitsScanned === 'number' ? data.commitsScanned : null;

                if (typeof gtag !== 'undefined') {
                    gtag('event', 'public_scan_completed', {
                        repo: repo,
                        findings_count: findings.length,
                        files_scanned: filesScanned,
                        commits_scanned: commitsScanned
                    });
                }

                show('resultsContainer');

                var summaryEl = document.getElementById('resultsSummary');
                var repoLabel = document.getElementById('repoLabel');
                repoLabel.textContent = repo;

                // Partition by category
                var secretFindings  = findings.filter(function(f) { return f.category === 'secret' || !f.category; });
                var fileFindings    = findings.filter(function(f) { return f.category === 'file'; });
                var codeFindings    = findings.filter(function(f) { return f.category === 'code'; });
                var hygieneFindings = findings.filter(function(f) { return f.category === 'hygiene'; });
                var criticalCount   = secretFindings.length + fileFindings.length + codeFindings.length;

                var parts = [];
                if (filesScanned) parts.push(filesScanned + ' file' + (filesScanned !== 1 ? 's' : ''));
                if (commitsScanned) parts.push(commitsScanned + ' commit' + (commitsScanned !== 1 ? 's' : ''));
                var scanPart = parts.length ? ' — scanned ' + parts.join(' + ') : '';

                if (criticalCount === 0) {
                    summaryEl.textContent = 'No issues found' + scanPart;
                    hide('findingsList');
                    hide('stickyBar');
                    show('emptyState');
                    renderExtraFindings([], [], hygieneFindings);
                } else {
                    var histCount = secretFindings.filter(function(f) { return f.source === 'history'; }).length;
                    var histPart  = histCount > 0 ? ' (' + histCount + ' in git history)' : '';
                    summaryEl.textContent = criticalCount + ' issue' + (criticalCount !== 1 ? 's' : '') + ' found' + histPart + scanPart;
                    hide('emptyState');
                    show('findingsList');
                    renderFindings(secretFindings, repo);
                    document.getElementById('stickyCount').textContent = criticalCount + ' issue' + (criticalCount !== 1 ? 's' : '') + ' found';
                    show('stickyBar');
                    renderExtraFindings(fileFindings, codeFindings, hygieneFindings);
                }

            } catch (err) {
                hide('progressBox');
                setScanning(false);
                showError('Network error — check your connection and try again.');
            }
        }

        // ── Form submit ──────────────────────────────────────────────────────────
        document.getElementById('scanForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const val = document.getElementById('repoInput').value.trim();
            if (!val) return;
            runScan(val);
        });

        // ── Example prefill ──────────────────────────────────────────────────────
        function prefillExample() {
            document.getElementById('repoInput').value = 'github.com/trufflesecurity/trufflehog';
            document.getElementById('repoInput').focus();
        }

        var exampleRepoBtn = document.getElementById('exampleRepoBtn');
        if (exampleRepoBtn) {
            exampleRepoBtn.addEventListener('click', prefillExample);
        }

        // ── Mobile nav toggle ────────────────────────────────────────────────────
        document.getElementById('mobileToggle').addEventListener('click', function() {
            const menu = document.getElementById('mobileMenu');
            menu.classList.toggle('open');
        });

        // ── URL param: ?repo=owner/repo → pre-fill only (no auto-submit) ─────────
        // Auto-submitting allowed scan-bombing and phishing via crafted links.
        (function() {
            const params = new URLSearchParams(window.location.search);
            const repoParam = params.get('repo');
            if (repoParam) {
                const input = document.getElementById('repoInput');
                // Validate format before pre-filling to avoid injecting garbage into the input
                const safe = repoParam.match(/^[a-zA-Z0-9_.\-]{1,100}\/[a-zA-Z0-9_.\-]{1,100}$/);
                if (safe) {
                    input.value = repoParam;
                    input.focus();
                }
            }
        })();
