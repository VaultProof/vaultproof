(function() {
  var tourSteps = [
    { target: '#statsGrid', text: 'Welcome to VaultProof! These cards show your real-time usage — total keys stored, active providers, API calls, and error rate.', position: 'bottom' },
    { target: '#keys-table', text: 'Your API keys live here. Each key is split before storage and only assembled briefly during API calls. You can add, rotate, or revoke keys.', position: 'bottom' },
    { target: '#nav-api-keys', text: 'Go to API Keys to store your first key. Choose a provider (OpenAI, Anthropic, etc.), paste your key, and it\'s split instantly in your browser.', position: 'right' },
    { target: '#nav-settings', text: 'View your project ID and proxy settings here. Your vp-proj- project ID is how your app routes through VaultProof.', position: 'right' },
    { target: '#activityPanel', text: 'Every API call, key rotation, and access event shows up here in real time. Full audit trail for all your keys.', position: 'left' },
    { target: '#nav-scanner', text: 'Scan your GitHub repos for accidentally exposed API keys. VaultProof catches them before anyone else does.', position: 'right' },
    { target: '#cli-card', text: 'One command to protect every key: npx @vaultproof/init — scans your .env, splits each key, rewrites with one project ID.', position: 'bottom' },
    { target: '#quick-access', text: 'Quick links to jump to any section. Ready to secure your first key?', position: 'top', last: true }
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

  function positionBubble(target, pos) {
    var rect = target.getBoundingClientRect();
    var scrollX = window.scrollX || window.pageXOffset;
    var scrollY = window.scrollY || window.pageYOffset;
    bubbleEl.classList.remove('visible');
    var bw = 340, gap = 16;
    var top, left;
    if (pos === 'bottom') {
      top = rect.bottom + scrollY + gap;
      left = rect.left + scrollX;
      arrowEl.setAttribute('data-pos', 'bottom');
    } else if (pos === 'top') {
      top = rect.top + scrollY - gap - 120;
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
    if (left + bw > window.innerWidth + scrollX - 16) left = window.innerWidth + scrollX - bw - 16;
    if (left < scrollX + 16) left = scrollX + 16;
    if (top < scrollY + 16) top = scrollY + 16;
    bubbleEl.style.top = top + 'px';
    bubbleEl.style.left = left + 'px';
    requestAnimationFrame(function() {
      bubbleEl.classList.add('visible');
      // Scroll so the bubble is fully visible
      var bubbleRect = bubbleEl.getBoundingClientRect();
      if (bubbleRect.bottom > window.innerHeight) {
        window.scrollBy({ top: bubbleRect.bottom - window.innerHeight + 32, behavior: 'smooth' });
      } else if (bubbleRect.top < 0) {
        window.scrollBy({ top: bubbleRect.top - 32, behavior: 'smooth' });
      }
    });
  }

  function showTourStep(step) {
    document.querySelectorAll('.guide-highlight').forEach(function(el) { el.classList.remove('guide-highlight'); });
    var s = tourSteps[step];
    var target = document.querySelector(s.target);
    if (!target) return;
    target.classList.add('guide-highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    textEl.textContent = s.text;
    counterEl.textContent = 'Step ' + (step + 1) + ' of ' + tourSteps.length;
    backBtn.style.display = step === 0 ? 'none' : '';
    if (s.last) {
      nextBtn.textContent = 'Get Started';
      nextBtn.onclick = function() { endTour(); window.location.href = '/app/keys'; };
    } else {
      nextBtn.textContent = 'Next';
      nextBtn.onclick = nextTourStep;
    }
    setTimeout(function() { positionBubble(target, s.position); }, 350);
  }

  window.nextTourStep = function() {
    if (currentStep < tourSteps.length - 1) { currentStep++; showTourStep(currentStep); }
  };
  window.prevTourStep = function() {
    if (currentStep > 0) { currentStep--; showTourStep(currentStep); }
  };
  window.endTour = function() {
    tourActive = false;
    bubbleEl.classList.remove('visible');
    overlayEl.classList.remove('active');
    document.querySelectorAll('.guide-highlight').forEach(function(el) { el.classList.remove('guide-highlight'); });
    // Mark tour as seen — localStorage as immediate fallback, API for persistence
    localStorage.setItem('vp_app_tour_done', '1');
    fetch(API + '/auth/tour-complete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    }).catch(function() {});
  };
  window.startAppTour = function() {
    tourActive = true;
    currentStep = 0;
    overlayEl.classList.add('active');
    showTourStep(0);
  };

  overlayEl.addEventListener('click', endTour);

  // Tour eligibility check. Exposed so dismissWelcome() can call it after the
  // user closes the welcome modal. Only marks the tour "done" when the server
  // confirms hasSeenTour=true — transient /auth/me failures don't suppress it.
  window.maybeStartAppTour = async function() {
    if (localStorage.getItem('vp_app_tour_done') === '1') return;
    try {
      var data = await apiFetch('/auth/me');
      if (!data || !data.user) return;
      if (data.user.hasSeenTour) {
        localStorage.setItem('vp_app_tour_done', '1');
        return;
      }
      setTimeout(window.startAppTour, 1500);
    } catch(e) {}
  };

  // Auto-start only if the welcome modal won't show first. On a fresh account
  // with no vp_welcomed flag, dismissWelcome() triggers the tour instead.
  if (localStorage.getItem('vp_welcomed')) {
    window.maybeStartAppTour();
  }

  window.addEventListener('resize', function() {
    if (tourActive) {
      var s = tourSteps[currentStep];
      var target = document.querySelector(s.target);
      if (target) positionBubble(target, s.position);
    }
  });
})();
