(function () {
  'use strict';

  if (!window.__vpI18nLoaderAdded) {
    window.__vpI18nLoaderAdded = true;
    var i18nScript = document.createElement('script');
    i18nScript.src = '/js/site-i18n.js?v=20260523b';
    i18nScript.defer = true;
    document.head.appendChild(i18nScript);
  }

  var API = 'https://api.vaultproof.dev/analytics/event';

  // ── Visitor ID (persists forever in localStorage) ───────────────
  var visitorId = localStorage.getItem('vp_vid');
  if (!visitorId) {
    visitorId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('vp_vid', visitorId);
  }

  // ── Session ID (sessionStorage + 30-min timeout) ───────────────
  var SESSION_TIMEOUT = 30 * 60 * 1000;
  var now = Date.now();
  var lastActive = parseInt(sessionStorage.getItem('vp_last_active') || '0', 10);
  var sessionId = sessionStorage.getItem('vp_sid');

  if (!sessionId || (now - lastActive) > SESSION_TIMEOUT) {
    sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Math.random().toString(36).slice(2) + Date.now().toString(36));
    sessionStorage.setItem('vp_sid', sessionId);
  }
  sessionStorage.setItem('vp_last_active', String(now));

  // ── UTM params (captured once per session) ─────────────────────
  var params = new URLSearchParams(location.search);
  var utmSource = params.get('utm_source') || sessionStorage.getItem('vp_utm_source') || null;
  var utmMedium = params.get('utm_medium') || sessionStorage.getItem('vp_utm_medium') || null;
  var utmCampaign = params.get('utm_campaign') || sessionStorage.getItem('vp_utm_campaign') || null;
  if (utmSource) sessionStorage.setItem('vp_utm_source', utmSource);
  if (utmMedium) sessionStorage.setItem('vp_utm_medium', utmMedium);
  if (utmCampaign) sessionStorage.setItem('vp_utm_campaign', utmCampaign);

  // ── Referrer (external only) ───────────────────────────────────
  var ref = null;
  if (document.referrer) {
    try {
      var refHost = new URL(document.referrer).hostname;
      if (refHost !== location.hostname) ref = document.referrer;
    } catch (e) {}
  }

  // ── Send event helper ─────────────────────────────────────────
  function send(type, properties) {
    var payload = {
      type: type,
      page: location.pathname,
      referrer: ref,
      sessionId: sessionId,
      visitorId: visitorId,
      utmSource: utmSource,
      utmMedium: utmMedium,
      utmCampaign: utmCampaign
    };
    if (properties) payload.properties = properties;

    try {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}

    // Update last active on every event
    sessionStorage.setItem('vp_last_active', String(Date.now()));
  }

  // ── Auto-track pageview ────────────────────────────────────────
  send('pageview');

  // ── Expose global tracker for product events ───────────────────
  window.vp = window.vp || {};
  window.vp.track = function (type, properties) {
    send(type, properties);
  };
})();
