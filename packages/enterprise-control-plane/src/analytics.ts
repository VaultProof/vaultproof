import type { EnterpriseControlPlaneEnv } from './config.js';

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function jsonScriptValue(value: unknown): string {
  return JSON.stringify(value).replaceAll('</', '<\\/');
}

export function renderEnterpriseAnalyticsSnippet(
  env: EnterpriseControlPlaneEnv,
  pageName: string,
): string {
  const token = env.mixpanelToken?.trim();
  if (!token) return '';

  const config = {
    autocapture: env.mixpanelAutocapture === true,
    ignore_dnt: false,
    persistence: 'localStorage',
    record_sessions_percent: clampPercent(env.mixpanelRecordSessionsPercent),
    track_pageview: false,
  };

  return `  <script>
    (function() {
      var token = ${jsonScriptValue(token)};
      var pageName = ${jsonScriptValue(pageName)};
      var config = ${jsonScriptValue(config)};
      if (!token || window.__vaultproofEnterpriseMixpanelLoaded) return;
      window.__vaultproofEnterpriseMixpanelLoaded = true;
      (function(doc, mixpanel) {
        if (!mixpanel.__SV) {
          var script = doc.createElement("script");
          script.type = "text/javascript";
          script.async = true;
          script.src = "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";
          var first = doc.getElementsByTagName("script")[0];
          first.parentNode.insertBefore(script, first);
          var methods = "disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove".split(" ");
          mixpanel._i = [];
          mixpanel.init = function(tokenValue, options, name) {
            function proxy(target, method) {
              var parts = method.split(".");
              if (parts.length === 2) {
                target = target[parts[0]];
                method = parts[1];
              }
              target[method] = function() {
                target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
              };
            }
            var target = mixpanel;
            if (typeof name !== "undefined") {
              target = mixpanel[name] = [];
            } else {
              name = "mixpanel";
            }
            target.people = target.people || [];
            methods.forEach(function(method) { proxy(target, method); });
            mixpanel._i.push([tokenValue, options, name]);
          };
          mixpanel.__SV = 1.2;
        }
      })(document, window.mixpanel || (window.mixpanel = []));

      window.mixpanel.init(token, config);
      window.mixpanel.register({
        vaultproof_surface: "enterprise_control_plane",
        vaultproof_hostname: window.location.hostname
      });
      window.mixpanel.track("Enterprise Page Viewed", {
        page: pageName,
        path: window.location.pathname
      });
      document.addEventListener("click", function(event) {
        var target = event.target;
        var link = target && target.closest ? target.closest("a[href]") : null;
        if (!link) return;
        var href = link.getAttribute("href") || "";
        if (!href || (!href.startsWith("/app") && !href.startsWith("/api/v1/enterprise"))) return;
        window.mixpanel.track("Enterprise Navigation Clicked", {
          page: pageName,
          href: href,
          label: (link.textContent || "").trim().slice(0, 80)
        });
      }, { capture: true });
    })();
  </script>`;
}

export function injectEnterpriseAnalytics(
  html: string,
  env: EnterpriseControlPlaneEnv,
  pageName: string,
): string {
  const snippet = renderEnterpriseAnalyticsSnippet(env, pageName);
  if (!snippet) return html;
  if (html.includes('</head>')) return html.replace('</head>', `${snippet}\n</head>`);
  return `${html}\n${snippet}`;
}
