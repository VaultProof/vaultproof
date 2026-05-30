(function() {
  var SHELL_ROUTES = {
    '/app': true,
    '/app/': true,
    '/app/activity': true,
    '/app/alerts': true
  };
  var STYLE_SELECTOR = 'style[data-app-shell-style]';
  var LINK_STYLE_SELECTOR = 'link[rel="stylesheet"][data-app-shell-stylesheet]';
  var PAGE_SCRIPT_SELECTOR = 'script[data-app-shell-page-script]';
  var RUNTIME_SCRIPT_SELECTOR = 'script[data-app-shell-runtime]';
  var navInFlight = null;

  function normalizePath(pathname) {
    if (!pathname) return '/';
    if (pathname === '/app') return '/app/';
    if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
    return pathname;
  }

  function isShellRoute(pathname) {
    var normalized = normalizePath(pathname);
    return Boolean(SHELL_ROUTES[normalized] || SHELL_ROUTES[normalized + '/']);
  }

  function sameOriginLink(anchor) {
    return anchor && anchor.origin === window.location.origin;
  }

  function isModifiedEvent(event) {
    return event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  function updateSidebar(pathname) {
    var normalized = normalizePath(pathname);
    var sidebarLinks = document.querySelectorAll('.sidebar a[href]');
    sidebarLinks.forEach(function(link) {
      var linkPath = normalizePath(new URL(link.href, window.location.origin).pathname);
      var active = linkPath === normalized;
      link.classList.toggle('active', active);
      link.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function syncPageStyle(nextDoc) {
    var nextStyle = nextDoc.querySelector(STYLE_SELECTOR);
    if (nextStyle) {
      var currentStyle = document.head.querySelector(STYLE_SELECTOR);
      var replacement = nextStyle.cloneNode(true);
      if (currentStyle) currentStyle.replaceWith(replacement);
      else document.head.appendChild(replacement);
    }

    document.head.querySelectorAll(LINK_STYLE_SELECTOR).forEach(function(link) {
      link.remove();
    });
    nextDoc.querySelectorAll(LINK_STYLE_SELECTOR).forEach(function(link) {
      document.head.appendChild(link.cloneNode(true));
    });
  }

  function syncTopbarAndMain(nextDoc) {
    var nextTopbar = nextDoc.querySelector('.page > .topbar');
    var nextMain = nextDoc.querySelector('.layout > .main');
    var currentTopbar = document.querySelector('.page > .topbar');
    var currentMain = document.querySelector('.layout > .main');

    if (!nextTopbar || !nextMain || !currentTopbar || !currentMain) {
      throw new Error('Shell structure mismatch');
    }

    currentTopbar.replaceWith(nextTopbar.cloneNode(true));
    currentMain.replaceWith(nextMain.cloneNode(true));
  }

  function syncEnterpriseSidebar(nextDoc) {
    var nextSidebar = nextDoc.querySelector('.sidebar.enterprise-app-sidebar');
    var currentSidebar = document.querySelector('.sidebar.enterprise-app-sidebar');
    if (!nextSidebar || !currentSidebar) return;
    currentSidebar.replaceWith(nextSidebar.cloneNode(true));
  }

  function unloadRuntimeScripts() {
    document.querySelectorAll(RUNTIME_SCRIPT_SELECTOR).forEach(function(script) {
      script.remove();
    });
  }

  function loadPageScripts(nextDoc) {
    var scriptSrcs = Array.prototype.map.call(
      nextDoc.querySelectorAll(PAGE_SCRIPT_SELECTOR),
      function(script) { return script.getAttribute('src'); }
    ).filter(Boolean);

    unloadRuntimeScripts();

    scriptSrcs.forEach(function(src) {
      var script = document.createElement('script');
      script.src = src;
      script.defer = false;
      script.dataset.appShellRuntime = '1';
      document.body.appendChild(script);
    });
  }

  async function navigate(url, options) {
    var opts = options || {};
    var target = new URL(url, window.location.origin);

    if (!isShellRoute(target.pathname)) {
      window.location.href = target.href;
      return;
    }

    if (navInFlight) return navInFlight;

    document.body.setAttribute('data-shell-loading', '1');

    navInFlight = fetch(target.pathname + target.search, {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'vp-app-shell'
      }
    }).then(function(response) {
      if (!response.ok) throw new Error('Failed to fetch target page');
      return response.text();
    }).then(function(html) {
      var parser = new DOMParser();
      var nextDoc = parser.parseFromString(html, 'text/html');

      syncPageStyle(nextDoc);
      syncEnterpriseSidebar(nextDoc);
      syncTopbarAndMain(nextDoc);
      loadPageScripts(nextDoc);
      updateSidebar(target.pathname);

      document.title = nextDoc.title || document.title;
      if (opts.push !== false) {
        window.history.pushState({ path: target.pathname + target.search }, '', target.pathname + target.search);
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }).catch(function() {
      window.location.href = target.href;
    }).finally(function() {
      navInFlight = null;
      document.body.removeAttribute('data-shell-loading');
    });

    return navInFlight;
  }

  document.addEventListener('click', function(event) {
    var anchor = event.target.closest('a[href]');
    if (!anchor || !sameOriginLink(anchor) || isModifiedEvent(event)) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;

    var targetUrl = new URL(anchor.href, window.location.origin);
    if (!isShellRoute(targetUrl.pathname)) return;

    event.preventDefault();
    navigate(targetUrl.href);
  });

  window.addEventListener('popstate', function() {
    if (!isShellRoute(window.location.pathname)) return;
    navigate(window.location.href, { push: false });
  });

  updateSidebar(window.location.pathname);
})();
