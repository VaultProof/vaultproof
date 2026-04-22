(function () {
  'use strict';

  var MIXPANEL_TOKEN = '0c509a4ba7934ed67e169f51b6947664';
  var MIXPANEL_SRC = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
  var mixpanelQueue = [];
  var mixpanelPollStarted = false;

  if (!window.__vpI18nLoaderAdded) {
    window.__vpI18nLoaderAdded = true;
    var i18nScript = document.createElement('script');
    i18nScript.src = '/js/site-i18n.js?v=20260420';
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

  function initMixpanel() {
    if (!window.mixpanel || typeof window.mixpanel.init !== 'function') return false;

    if (!window.__vpMixpanelInitialized) {
      window.mixpanel.init(MIXPANEL_TOKEN, {
        autocapture: {
          click: true,
          input: true,
          scroll: true,
          submit: true,
          capture_text_content: false
        },
        record_sessions_percent: 100,
        persistence: 'localStorage'
      });
      window.__vpMixpanelInitialized = true;
    }

    if (typeof window.mixpanel.identify === 'function') {
      window.mixpanel.identify(visitorId);
    }
    if (typeof window.mixpanel.register === 'function') {
      window.mixpanel.register({
        visitor_id: visitorId,
        session_id: sessionId,
        site_surface: location.pathname.indexOf('/app/') === 0 ? 'site-app' : 'site'
      });
    }

    return true;
  }

  function loadMixpanel() {
    if (initMixpanel()) return;
    if (window.__vpMixpanelRequested) return;
    window.__vpMixpanelRequested = true;

    var script = document.querySelector('script[data-vp-mixpanel]');
    if (script) return;

    script = document.createElement('script');
    script.src = MIXPANEL_SRC;
    script.async = true;
    script.setAttribute('data-vp-mixpanel', 'true');
    script.onload = function () {
      if (initMixpanel()) flushMixpanelQueue();
    };
    document.head.appendChild(script);
  }

  function dispatchMixpanelEvent(event) {
    if (!initMixpanel()) return false;
    try {
      if (event.type === 'pageview' && typeof window.mixpanel.track_pageview === 'function') {
        window.mixpanel.track_pageview(event.properties || {});
        return true;
      }
      if (typeof window.mixpanel.track === 'function') {
        window.mixpanel.track(event.type, event.properties || {});
        return true;
      }
    } catch (e) {}
    return false;
  }

  function flushMixpanelQueue() {
    if (!mixpanelQueue.length) return;
    mixpanelQueue = mixpanelQueue.filter(function (event) {
      return !dispatchMixpanelEvent(event);
    });
  }

  function queueMixpanelEvent(type, properties) {
    var event = { type: type, properties: properties || {} };
    if (dispatchMixpanelEvent(event)) return;

    mixpanelQueue.push(event);
    loadMixpanel();

    if (!mixpanelPollStarted) {
      mixpanelPollStarted = true;
      var attempts = 0;
      var interval = setInterval(function () {
        attempts += 1;
        flushMixpanelQueue();
        if (!mixpanelQueue.length || attempts >= 40) {
          clearInterval(interval);
        }
      }, 250);
    }
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

    var mixpanelProperties = {
      page: location.pathname,
      referrer: ref,
      session_id: sessionId,
      visitor_id: visitorId,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      site_surface: location.pathname.indexOf('/app/') === 0 ? 'site-app' : 'site'
    };
    if (properties) {
      for (var key in properties) {
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          mixpanelProperties[key] = properties[key];
        }
      }
    }
    queueMixpanelEvent(type, mixpanelProperties);

    // Update last active on every event
    sessionStorage.setItem('vp_last_active', String(Date.now()));
  }

  loadMixpanel();

  // ── Auto-track pageview ────────────────────────────────────────
  send('pageview');

  // ── Expose global tracker for product events ───────────────────
  window.vp = window.vp || {};
  window.vp.track = function (type, properties) {
    send(type, properties);
  };
})();
