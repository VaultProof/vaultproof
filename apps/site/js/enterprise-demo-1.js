(function() {
  function isLoggedIn() {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          var data = JSON.parse(localStorage.getItem(key));
          if (data && data.access_token && data.expires_at > Date.now() / 1000) return true;
        } catch (err) {}
      }
    }
    return false;
  }

  if (isLoggedIn()) {
    document.querySelectorAll('.nav-dashboard').forEach(function(el) {
      el.style.display = '';
    });
  }

  var mobileToggle = document.getElementById('mobileToggle');
  var mobileMenu = document.getElementById('mobileMenu');
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', function() {
      mobileMenu.classList.toggle('open');
    });

    mobileMenu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        mobileMenu.classList.remove('open');
      });
    });
  }

  var revealObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(function(el) {
    revealObserver.observe(el);
  });

  function bulletCard(text) {
    return '<div class="detail-card" style="padding:14px;">' + text + '</div>';
  }

  function metricCard(metric) {
    var extraStyle = metric.accent
      ? ' background: var(--accent-soft); border-color: rgba(217,119,6,0.18);'
      : '';
    return '<div class="stat-card" style="padding:16px;' + extraStyle + '">' +
      '<dt>' + metric.label + '</dt>' +
      '<dd>' + metric.value + '</dd>' +
    '</div>';
  }

  var stakeholderData = {
    ciso: {
      label: 'CISO View',
      title: 'Remove raw third-party keys from the highest-risk surfaces.',
      body: 'The pitch for security leaders is simple: secrets managers still hand plaintext keys to apps and pipelines. VaultProof keeps the key out of those environments entirely, then adds enforceable runtime policy on the calls that remain.',
      bullets: [
        'Origin lock and IP policy reduce misuse when identifiers leak.',
        'Per-key logs and revoke controls compress incident response time.',
        'Budget caps and provider restrictions shrink blast radius.',
        'Works alongside existing vaults rather than replacing them.'
      ],
      metrics: [
        { label: 'Primary Outcome', value: 'Plaintext key exposure reduced across runtime surfaces', accent: true },
        { label: 'Buying Trigger', value: 'Security review after leaked .env, repo scan finding, or AI rollout' },
        { label: 'Fastest Pilot', value: 'One app, one provider, one project ID, 2-week proof' }
      ]
    },
    platform: {
      label: 'Platform View',
      title: 'Ship the control without forcing every team through a rewrite.',
      body: 'Platform teams care about rollout friction. The strongest enterprise motion is minimal code change, provider-compatible routing, and a single project identifier that can be pushed across environments without re-educating every app team.',
      bullets: [
        'Reuse the provider SDK the team already has in production.',
        'Pilot on one service before expanding to CI or browser traffic.',
        'Use one control plane for logs, rate limits, and revoke events.',
        'Lower migration friction than a full secrets-manager redesign.'
      ],
      metrics: [
        { label: 'Primary Outcome', value: 'Short path from pilot to multi-team rollout', accent: true },
        { label: 'Buying Trigger', value: 'Platform team standardizing outbound AI or payment integrations' },
        { label: 'Fastest Pilot', value: 'Stage one backend service and validate policy in logs' }
      ]
    },
    product: {
      label: 'Product / AI View',
      title: 'Let teams ship AI features without normalizing secret sprawl.',
      body: 'Product and AI leaders are often moving fastest. They need a way to put copilots, agents, and model features into production without every feature team copying provider keys into new services, workflows, or prototypes.',
      bullets: [
        'Protect AI provider keys across agents, copilots, and automation.',
        'Use spend controls to limit damage from runaway prompts or abuse.',
        'Route calls per provider without handing raw credentials to apps.',
        'Give security a runtime boundary without slowing feature delivery.'
      ],
      metrics: [
        { label: 'Primary Outcome', value: 'Safer AI rollout without blocking product velocity', accent: true },
        { label: 'Buying Trigger', value: 'New AI product launch, agent project, or customer-facing copilot' },
        { label: 'Fastest Pilot', value: 'One AI workflow with usage caps and provider policy' }
      ]
    }
  };

  function renderStakeholder(tab) {
    var data = stakeholderData[tab];
    if (!data) return;

    var label = document.getElementById('stakeholderLabel');
    var title = document.getElementById('stakeholderTitle');
    var body = document.getElementById('stakeholderBody');
    var bullets = document.getElementById('stakeholderBullets');
    var metrics = document.getElementById('stakeholderMetrics');

    if (label) label.textContent = data.label;
    if (title) title.textContent = data.title;
    if (body) body.textContent = data.body;
    if (bullets) bullets.innerHTML = data.bullets.map(bulletCard).join('');
    if (metrics) metrics.innerHTML = data.metrics.map(metricCard).join('');

    document.querySelectorAll('[data-tab]').forEach(function(button) {
      button.classList.toggle('active', button.getAttribute('data-tab') === tab);
    });
  }

  document.querySelectorAll('[data-tab]').forEach(function(button) {
    button.addEventListener('click', function() {
      renderStakeholder(button.getAttribute('data-tab'));
    });
  });

  var scenarioData = {
    apps: {
      label: 'Web App Pattern',
      title: 'Browser and backend share one policy-controlled path.',
      body: 'For SaaS teams, the cleanest motion is to replace raw provider secrets in the backend and origin-lock browser traffic. That makes leaked front-end identifiers much less dangerous and gives the security team a visible boundary around outbound API usage.',
      checklist: [
        'Lock calls to your production origin and selected API routes.',
        'Use the same provider SDK with a rewritten base URL.',
        'Track usage, errors, and revoke events in a shared dashboard.'
      ],
      champion: 'Security + platform engineering',
      pilot: 'One production API integration and one staging environment',
      win: 'Removes .env exposure without a full secret-manager migration.'
    },
    cicd: {
      label: 'CI/CD Pattern',
      title: 'Keep provider keys out of pipelines that attackers love to target.',
      body: 'The CI/CD walkthrough should show that even if a job runner or action is compromised, the third-party provider key is not sitting in plaintext inside the workflow. You route the call, apply policy, and retain a cleaner incident-response story.',
      checklist: [
        'Replace provider secret injection with a project ID and proxy path.',
        'Apply IP policy or pipeline-specific controls at the gateway.',
        'Audit outbound provider usage after each workflow run.'
      ],
      champion: 'Platform security or DevSecOps',
      pilot: 'One GitHub Actions or CI job with a high-value provider key',
      win: 'Changes the runner from secret holder to policy-bound client.'
    },
    devices: {
      label: 'IoT / Robot Pattern',
      title: 'Protect fleet-facing services without shipping raw vendor keys downstream.',
      body: 'For IoT and robotics teams, the practical pattern is to keep provider credentials in the control plane or gateway layer instead of embedding them in field-facing services. That supports safer rotation and cleaner revocation when devices or operators are compromised.',
      checklist: [
        'Terminate device traffic at a gateway or cloud control plane.',
        'Route third-party API calls through VaultProof from that layer.',
        'Use policy and logs to separate device identity from provider secret use.'
      ],
      champion: 'Platform engineering + infrastructure security',
      pilot: 'One gateway-backed workflow for telemetry, alerts, or AI actions',
      win: 'Keeps fleet expansion from turning into key-copy sprawl.'
    },
    vehicles: {
      label: 'Connected Vehicle Pattern',
      title: 'Make the cloud service hold policy, not every downstream component.',
      body: 'The realistic car story is not putting provider keys in the vehicle. It is using VaultProof at the cloud edge or vehicle service layer so telemetry, copilots, support workflows, or third-party APIs are policy-controlled without exposing the upstream credential in broad operational systems.',
      checklist: [
        'Use the vehicle backend or telematics service as the enforcement point.',
        'Limit routes and providers per program or environment.',
        'Revoke or rotate centrally without touching every downstream client.'
      ],
      champion: 'Security architecture + connected services team',
      pilot: 'One backend service that talks to a third-party API for vehicle workflows',
      win: 'Creates a central control point for external API trust in automotive systems.'
    }
  };

  function renderScenario(name) {
    var data = scenarioData[name];
    if (!data) return;

    var label = document.getElementById('scenarioLabel');
    var title = document.getElementById('scenarioTitle');
    var body = document.getElementById('scenarioBody');
    var checklist = document.getElementById('scenarioChecklist');
    var champion = document.getElementById('scenarioChampion');
    var pilot = document.getElementById('scenarioPilot');
    var win = document.getElementById('scenarioWin');

    if (label) label.textContent = data.label;
    if (title) title.textContent = data.title;
    if (body) body.textContent = data.body;
    if (checklist) checklist.innerHTML = data.checklist.map(bulletCard).join('');
    if (champion) champion.textContent = data.champion;
    if (pilot) pilot.textContent = data.pilot;
    if (win) win.textContent = data.win;

    document.querySelectorAll('[data-scenario]').forEach(function(button) {
      button.classList.toggle('active', button.getAttribute('data-scenario') === name);
    });
  }

  document.querySelectorAll('[data-scenario]').forEach(function(button) {
    button.addEventListener('click', function() {
      renderScenario(button.getAttribute('data-scenario'));
    });
  });

  renderStakeholder('ciso');
  renderScenario('apps');
})();
