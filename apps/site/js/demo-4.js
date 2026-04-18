// ── Guided Tour ──
  var tourSteps = [
    { target: '#demo-banner', text: 'Welcome to VaultProof! This is a demo of your dashboard. Let\u2019s walk through how everything works.', position: 'bottom' },
    { target: '#stats-cards', text: 'These cards show your real-time usage \u2014 total keys stored, active providers, API calls today, and error rate.', position: 'bottom' },
    { target: '#keys-table', text: 'This is where your API keys live. Each key is split before storage \u2014 the full key is only assembled briefly during API calls. You can add, rotate, or revoke keys here.', position: 'bottom' },
    { target: '#keys-header', text: 'To store a key, click \u2018Add Key\u2019, choose your provider (OpenAI, Anthropic, etc.), and paste your key. It\u2019s split instantly in your browser.', position: 'bottom' },
    { target: '#sdk-card', text: 'Run npx @vaultproof/init once in your repo. VaultProof creates a project ID and rewrites your app to call provider-compatible proxy URLs.', position: 'bottom' },
    { target: '#sdk-card', text: 'Your app now uses the same project ID in place of raw provider secrets. Keep real keys out of .env and route calls through VaultProof.', position: 'top' },
    { target: '#activity-feed', text: 'Every API call, key rotation, and access event shows up here in real time. Full audit trail for your keys.', position: 'left' },
    { target: '#nav-api-keys', text: 'Manage all your stored keys from the API Keys page.', position: 'right' },
    { target: '#nav-access-logs', text: 'View detailed logs of every proxied API call \u2014 who made it, when, and which key was used.', position: 'right' },
    { target: '#nav-settings', text: 'Manage your plan, billing, and account settings here.', position: 'right' },
    { target: '#cli-card', text: 'Prefer the terminal? Install our CLI to store keys, proxy calls, and inject env vars \u2014 all from the command line.', position: 'bottom' },
    { target: '#quick-access', text: 'Quick links to jump to any section. Ready to try it for real?', position: 'top', last: true }
  ];

  var currentStep = 0;
  var tourActive = false;

  var bubbleEl = document.getElementById('guide-bubble');
  var arrowEl = document.getElementById('guide-arrow');
  var textEl = document.getElementById('guide-text');
  var counterEl = document.getElementById('guide-step-counter');
  var backBtn = document.getElementById('guide-back');
  var nextBtn = document.getElementById('guide-next');
  var overlayEl = document.getElementById('guide-overlay');
  var restartBtn = document.getElementById('restart-tour');

  function showStep(step) {
    // Remove previous highlights
    document.querySelectorAll('.guide-highlight').forEach(function(el) {
      el.classList.remove('guide-highlight');
    });

    var s = tourSteps[step];
    var target = document.querySelector(s.target);
    if (!target) return;

    // Add highlight
    target.classList.add('guide-highlight');

    // Scroll target into view — for fixed/sidebar elements, scroll to top first
    var rect = target.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setTimeout(function() {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    // Update bubble content
    textEl.textContent = s.text;
    counterEl.textContent = 'Step ' + (step + 1) + ' of ' + tourSteps.length;

    // Back button visibility
    backBtn.style.display = step === 0 ? 'none' : '';

    // Last step: change Next to Get Started
    if (s.last) {
      nextBtn.textContent = 'Get Started';
      nextBtn.onclick = function() { window.location.href = '/app/login'; };
    } else {
      nextBtn.textContent = 'Next';
      nextBtn.onclick = nextStep;
    }

    // Position the bubble after scroll settles
    setTimeout(function() { positionBubble(target, s.position); }, 350);
  }

  function positionBubble(target, pos) {
    var rect = target.getBoundingClientRect();
    var scrollX = window.scrollX || window.pageXOffset;
    var scrollY = window.scrollY || window.pageYOffset;

    bubbleEl.classList.remove('visible');
    bubbleEl.style.transform = '';

    var bw = 320; // max-width of bubble
    var gap = 16;

    var top, left;

    if (pos === 'bottom') {
      top = rect.bottom + scrollY + gap;
      left = rect.left + scrollX;
      arrowEl.setAttribute('data-pos', 'bottom');
    } else if (pos === 'top') {
      top = rect.top + scrollY - gap - 120; // approximate bubble height
      left = rect.left + scrollX;
      arrowEl.setAttribute('data-pos', 'top');
    } else if (pos === 'right') {
      top = rect.top + scrollY - 8;
      left = rect.right + scrollX + gap;
      arrowEl.setAttribute('data-pos', 'right');
    } else if (pos === 'left') {
      top = rect.top + scrollY - 8;
      left = rect.left + scrollX - bw - gap;
      arrowEl.setAttribute('data-pos', 'right');
    }

    // Clamp to viewport
    if (left + bw > window.innerWidth + scrollX - 16) {
      left = window.innerWidth + scrollX - bw - 16;
    }
    if (left < scrollX + 16) {
      left = scrollX + 16;
    }

    bubbleEl.style.top = top + 'px';
    bubbleEl.style.left = left + 'px';

    // Show bubble with animation
    requestAnimationFrame(function() {
      bubbleEl.classList.add('visible');
    });
  }

  function nextStep() {
    if (currentStep < tourSteps.length - 1) {
      currentStep++;
      showStep(currentStep);
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep);
    }
  }

  function endTour() {
    tourActive = false;
    bubbleEl.classList.remove('visible');
    overlayEl.classList.remove('active');
    document.querySelectorAll('.guide-highlight').forEach(function(el) {
      el.classList.remove('guide-highlight');
    });
    restartBtn.classList.remove('hidden');
    localStorage.setItem('vp_tour_done', '1');
  }

  function startTour() {
    tourActive = true;
    currentStep = 0;
    overlayEl.classList.add('active');
    restartBtn.classList.add('hidden');
    showStep(0);
  }

  // Click overlay to dismiss tour
  overlayEl.addEventListener('click', endTour);

  // Auto-start tour on first visit (after page animations settle)
  if (!localStorage.getItem('vp_tour_done')) {
    setTimeout(startTour, 1200);
  } else {
    restartBtn.classList.remove('hidden');
  }

  // Reposition bubble on resize
  window.addEventListener('resize', function() {
    if (tourActive) {
      var s = tourSteps[currentStep];
      var target = document.querySelector(s.target);
      if (target) positionBubble(target, s.position);
    }
  });
