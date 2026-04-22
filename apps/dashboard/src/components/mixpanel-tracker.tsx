"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MIXPANEL_TOKEN = "0c509a4ba7934ed67e169f51b6947664";
const MIXPANEL_SRC = "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";

type MixpanelApi = {
  init?: (token: string, config?: Record<string, unknown>) => void;
  track?: (event: string, properties?: Record<string, unknown>) => void;
  track_pageview?: (properties?: Record<string, unknown>) => void;
  register?: (properties: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    mixpanel?: MixpanelApi;
    __vpMixpanelInitialized?: boolean;
  }
}

function initMixpanel(): boolean {
  if (typeof window === "undefined" || !window.mixpanel || typeof window.mixpanel.init !== "function") {
    return false;
  }

  if (!window.__vpMixpanelInitialized) {
    window.mixpanel.init(MIXPANEL_TOKEN, {
      autocapture: {
        click: true,
        input: true,
        scroll: true,
        submit: true,
        capture_text_content: false,
      },
      record_sessions_percent: 100,
      persistence: "localStorage",
    });
    window.__vpMixpanelInitialized = true;
  }

  return true;
}

export function MixpanelTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (initMixpanel()) return undefined;

    const existing = document.querySelector<HTMLScriptElement>('script[data-vp-mixpanel="true"]');
    if (existing) return undefined;

    const script = document.createElement("script");
    script.src = MIXPANEL_SRC;
    script.async = true;
    script.dataset.vpMixpanel = "true";
    script.onload = () => {
      initMixpanel();
    };
    document.head.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const search = searchParams.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    if (!url || lastTrackedUrlRef.current === url) return undefined;
    lastTrackedUrlRef.current = url;

    let attempts = 0;
    let intervalId = 0;
    let timeoutId = 0;

    const trackPageView = () => {
      if (!initMixpanel()) return false;

      const properties = {
        page: pathname,
        search: search || undefined,
        title: document.title,
        site_surface: "dashboard",
      };

      if (typeof window.mixpanel?.register === "function") {
        window.mixpanel.register({ site_surface: "dashboard" });
      }

      if (typeof window.mixpanel?.track_pageview === "function") {
        window.mixpanel.track_pageview(properties);
        return true;
      }

      if (typeof window.mixpanel?.track === "function") {
        window.mixpanel.track("pageview", properties);
        return true;
      }

      return false;
    };

    if (trackPageView()) return undefined;

    intervalId = window.setInterval(() => {
      attempts += 1;
      if (trackPageView() || attempts >= 40) {
        window.clearInterval(intervalId);
      }
    }, 250);
    timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [pathname, searchParams]);

  return null;
}
