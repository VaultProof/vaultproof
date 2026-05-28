import type { EnterpriseControlPlaneEnv } from './config.js';
import { injectEnterpriseAnalytics } from './analytics.js';

export function renderEnterpriseHomepage(env: EnterpriseControlPlaneEnv = {}): string {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VaultProof - API keys that are harder to steal</title>
  <meta name="description" content="VaultProof protects important API keys. Your app calls VaultProof instead of storing the real key, and VaultProof safely uses the key for one request at a time." />
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --paper: #ffffff;
      --surface: #f8fafc;
      --card-bg: #ffffff;
      --row-bg: #f8fafc;
      --ink: #17202a;
      --ink-soft: #526170;
      --muted: #7a8794;
      --line: rgba(26, 40, 52, 0.14);
      --line-strong: rgba(26, 40, 52, 0.22);
      --line-soft: rgba(26, 40, 52, 0.08);
      --accent: #315f95;
      --accent-ink: #ffffff;
      --accent-soft: rgba(49, 95, 149, 0.12);
      --primary-bg: #315f95;
      --success: #15803d;
      --danger: #dc2626;
      --blue: #2563eb;
      --shadow: 0 18px 54px rgba(26, 40, 52, 0.10);
      --display: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --body: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--body);
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    a { color: inherit; text-decoration: none; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .vp-page { min-height: 100vh; overflow: hidden; }
    .vp-container { width: min(1280px, calc(100vw - 48px)); margin: 0 auto; }
    .vp-nav {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(245, 247, 251, 0.90);
      -webkit-backdrop-filter: blur(14px);
      backdrop-filter: blur(14px);
      border-bottom: 0.5px solid var(--line);
    }
    .vp-nav-inner {
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .vp-brand { display: flex; align-items: center; gap: 12px; min-width: 190px; }
    .vp-mark { width: 22px; height: 22px; display: block; }
    .vp-brand-title { font-size: 16px; font-weight: 500; letter-spacing: -0.005em; }
    .vp-brand-sub {
      margin-left: 8px;
      font: 500 9.5px/1 var(--mono);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .vp-links { display: flex; align-items: center; gap: 28px; }
    .vp-links a, .vp-signin { font-size: 13px; color: var(--ink-soft); }
    .vp-links a:hover, .vp-signin:hover { color: var(--ink); }
    .vp-actions { display: flex; align-items: center; gap: 14px; }
    .vp-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 42px;
      padding: 0 20px;
      border-radius: 7px;
      border: 0.5px solid var(--line);
      font: 500 14px/1 var(--body);
      transition: transform 180ms ease, background 180ms ease, color 180ms ease, border-color 180ms ease;
    }
    .vp-btn:hover { transform: translateY(-1px); }
    .vp-btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 650; }
    .vp-btn.secondary { background: rgba(255, 255, 255, 0.72); color: var(--ink); }
    .vp-section { border-bottom: 0.5px solid var(--line); position: relative; }
    .vp-section.surface { background: rgba(255, 255, 255, 0.46); }
    .vp-pad { padding: 64px 0; }
    .vp-eyebrow {
      display: flex;
      align-items: center;
      gap: 12px;
      font: 500 11px/1.2 var(--mono);
      color: var(--muted);
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .vp-eyebrow strong { color: var(--accent); font-weight: 500; }
    .vp-grid-bg {
      position: absolute;
      inset: -10% -8%;
      pointer-events: none;
      background-image: radial-gradient(rgba(26, 40, 52, 0.10) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: radial-gradient(ellipse at center, black 30%, transparent 74%);
      -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 74%);
      transform: translateY(var(--grid-y, 0px));
    }
    .vp-hero { padding: 70px 0 72px; }
    .vp-dateline {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 14px;
      margin-bottom: 48px;
      border-bottom: 0.5px solid var(--line);
      font: 400 11px/1.2 var(--mono);
      color: var(--muted);
      letter-spacing: 0.06em;
    }
    .vp-hero-title {
      max-width: 13.8ch;
      margin: 24px 0 0;
      font: 400 clamp(66px, 10.4vw, 164px)/0.92 var(--display);
      letter-spacing: -0.045em;
      text-wrap: balance;
    }
    .vp-hero-title em { color: var(--accent); font-style: italic; }
    .vp-hero-lower {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 1fr);
      gap: 64px;
      margin-top: 60px;
      padding-top: 44px;
      border-top: 0.5px solid var(--line);
      align-items: start;
    }
    .vp-lede {
      max-width: 35ch;
      margin: 0;
      color: var(--ink-soft);
      font-size: 19px;
      line-height: 1.52;
      text-wrap: pretty;
    }
    .vp-cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
    .vp-proof-stat {
      margin-top: 34px;
      display: grid;
      grid-template-columns: 170px 1fr;
      gap: 22px;
      align-items: start;
      padding-top: 22px;
      border-top: 0.5px solid var(--line);
    }
    .vp-stat-big {
      font: 400 48px/0.95 var(--display);
      letter-spacing: -0.025em;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
    .vp-stat-caption { margin: 0; color: var(--muted); font: 12px/1.5 var(--mono); letter-spacing: 0.03em; }
    .vp-feed-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      color: var(--muted);
      font: 11px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .vp-live { display: inline-flex; align-items: center; gap: 6px; text-transform: lowercase; letter-spacing: 0.04em; }
    .vp-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--success); animation: vp-blink 1.6s ease-in-out infinite; }
    .vp-feed-card {
      background: var(--card-bg);
      border: 0.5px solid var(--line);
      border-radius: 9px;
      padding: 5px 18px;
      box-shadow: var(--shadow);
    }
    .vp-feed-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 16px;
      padding: 14px 0;
      align-items: baseline;
      border-bottom: 0.5px solid var(--line-soft);
      font: 12.5px/1.3 var(--mono);
      color: var(--ink);
      animation: vp-feed-in 600ms cubic-bezier(.2,.6,.2,1) both;
    }
    .vp-feed-row:last-child { border-bottom: 0; }
    .vp-feed-row:nth-child(2) { opacity: .84; }
    .vp-feed-row:nth-child(3) { opacity: .68; }
    .vp-feed-row:nth-child(4) { opacity: .52; }
    .vp-feed-row:nth-child(5) { opacity: .36; }
    .vp-feed-row .muted { color: var(--muted); margin-left: 10px; }
    .vp-feed-row .accent { color: var(--accent); }
    .vp-feed-row .ok { color: var(--success); font-size: 11px; }
    .vp-note { margin: 14px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; text-wrap: pretty; }
    .vp-two-col {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(420px, 1.35fr);
      gap: 64px;
      align-items: center;
    }
    .vp-heading {
      margin: 20px 0 0;
      color: var(--ink);
      font: 400 clamp(40px, 4.4vw, 64px)/1 var(--display);
      letter-spacing: -0.026em;
      text-wrap: balance;
    }
    .vp-heading em { color: var(--accent); font-style: italic; }
    .vp-copy {
      margin: 24px 0 0;
      color: var(--ink-soft);
      font-size: 15.5px;
      line-height: 1.62;
      text-wrap: pretty;
    }
    .vp-steps {
      margin-top: 28px;
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 18px;
      row-gap: 10px;
      color: var(--ink-soft);
      font: 12px/1.45 var(--mono);
    }
    .vp-steps b { color: var(--accent); font-weight: 500; }
    .vp-figure {
      min-height: 430px;
      position: relative;
      overflow: hidden;
      background: var(--card-bg);
      border: 0.5px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, var(--shadow);
    }
    .vp-figure-grid {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(var(--line-soft) 1px, transparent 1px),
        linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .vp-key-core {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 88px;
      height: 88px;
      transform: translate(-50%, -50%);
      border: 0.5px solid var(--line-strong);
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: radial-gradient(circle, var(--accent-soft), transparent 70%);
      animation: vp-key-core 6s linear infinite;
    }
    .vp-key-glyph {
      width: 46px;
      height: 18px;
      border: 6px solid var(--success);
      border-right: 0;
      border-radius: 8px 0 0 8px;
      position: relative;
    }
    .vp-key-glyph::before {
      content: "";
      position: absolute;
      left: 33px;
      top: 2px;
      width: 42px;
      height: 6px;
      background: var(--success);
    }
    .vp-key-glyph::after {
      content: "";
      position: absolute;
      left: 60px;
      top: 2px;
      width: 4px;
      height: 15px;
      background: var(--success);
    }
    .vp-region {
      position: absolute;
      transform: translate(-50%, -50%);
      font: 10px/1 var(--mono);
      color: var(--muted);
      letter-spacing: 0.05em;
      text-align: center;
      text-transform: uppercase;
    }
    .vp-region i {
      display: block;
      width: 12px;
      height: 12px;
      margin: 0 auto 9px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(49, 95, 149, .24);
      animation: vp-region-pulse 6s linear infinite;
    }
    .vp-shard {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 32px;
      height: 22px;
      transform: translate(-50%, -50%);
      border: 0.5px solid var(--accent);
      border-radius: 3px;
      background: var(--paper);
      color: var(--accent);
      display: grid;
      place-items: center;
      font: 500 9px/1 var(--mono);
      animation: vp-shard 6s cubic-bezier(.6,.05,.3,1) infinite;
    }
    .vp-shard.s1 { --tx: -280px; --ty: -125px; --rot: -25deg; animation-delay: 0s; }
    .vp-shard.s2 { --tx: 300px; --ty: -130px; --rot: 18deg; animation-delay: .12s; }
    .vp-shard.s3 { --tx: -315px; --ty: 105px; --rot: 35deg; animation-delay: .24s; }
    .vp-shard.s4 { --tx: 318px; --ty: 110px; --rot: -28deg; animation-delay: .36s; }
    .vp-shard.s5 { --tx: 0px; --ty: 150px; --rot: 8deg; animation-delay: .48s; }
    .vp-wire {
      position: absolute;
      left: 10%;
      right: 10%;
      top: 52%;
      height: 1px;
      background: var(--line);
    }
    .vp-mechanism-grid {
      position: relative;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      padding: 72px 0 44px;
      border-top: 0.5px solid var(--line-strong);
      border-bottom: 0.5px solid var(--line-strong);
    }
    .vp-region-strip {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      padding-bottom: 16px;
      border-bottom: 0.5px dashed var(--line-soft);
      font: 10.5px/1.3 var(--mono);
      color: var(--muted);
      letter-spacing: 0.04em;
    }
    .vp-region-strip span { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .vp-region-strip i {
      width: 6px;
      height: 6px;
      flex: 0 0 6px;
      border-radius: 999px;
      border: 0.5px solid currentColor;
    }
    .vp-region-strip span:nth-child(-n+3) { color: var(--accent); }
    .vp-region-strip span:nth-child(-n+3) i { background: var(--accent); animation: vp-blink 2.4s ease-in-out infinite alternate; }
    .vp-node {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      text-align: center;
    }
    .vp-node-dot {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.86);
      border: 0.5px solid var(--line-strong);
      display: grid;
      place-items: center;
      color: var(--accent);
      font: 500 12px/1 var(--mono);
    }
    .vp-node:nth-child(2) .vp-node-dot { border-color: var(--accent); animation: vp-node-pulse 6s linear infinite; }
    .vp-node:nth-child(4) .vp-node-dot { animation: vp-zero-flash 6s linear infinite; }
    .vp-node h3 {
      margin: 0;
      font: 400 22px/1.1 var(--display);
      letter-spacing: -0.015em;
    }
    .vp-node p {
      max-width: 220px;
      margin: 6px auto 0;
      color: var(--ink-soft);
      font-size: 12.5px;
      line-height: 1.5;
      text-wrap: pretty;
    }
    .vp-beam {
      position: absolute;
      left: 37.5%;
      top: 50%;
      z-index: 1;
      width: 25%;
      height: 2px;
      border-radius: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      animation: vp-beam 6s cubic-bezier(.4,.1,.3,1) infinite;
    }
    .vp-threat-layout {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(420px, 1.2fr);
      gap: 72px;
      align-items: start;
    }
    .vp-sticky { position: sticky; top: 96px; }
    .vp-threat-row {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 32px;
      padding: 28px 0;
      border-top: 0.5px solid var(--line);
    }
    .vp-threat-row:last-child { border-bottom: 0.5px solid var(--line); }
    .vp-threat-stat {
      color: var(--ink);
      font: 400 48px/0.95 var(--display);
      letter-spacing: -0.025em;
      font-variant-numeric: tabular-nums;
    }
    .vp-threat-row p { margin: 0; color: var(--ink-soft); font-size: 15px; line-height: 1.55; text-wrap: pretty; }
    .vp-source { margin-top: 8px; color: var(--muted); font: 10.5px/1.35 var(--mono); letter-spacing: 0.04em; }
    .vp-code-layout {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(480px, 1.4fr);
      gap: 72px;
      align-items: start;
    }
    .vp-checklist {
      margin-top: 28px;
      display: grid;
      gap: 12px;
      color: var(--ink-soft);
      font-size: 13.5px;
    }
    .vp-checklist span::before { content: "↳"; color: var(--accent); font-family: var(--mono); font-size: 11px; margin-right: 10px; }
    .vp-code-card {
      background: var(--card-bg);
      border: 0.5px solid var(--line);
      border-radius: 9px;
      overflow: hidden;
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, var(--shadow);
    }
    .vp-code-head, .vp-code-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px;
      color: var(--muted);
      font: 11px/1.3 var(--mono);
      border-bottom: 0.5px solid var(--line);
    }
    .vp-code-foot { border-top: 0.5px solid var(--line); border-bottom: 0; padding: 12px 20px; }
    .vp-window-dots { display: flex; gap: 6px; }
    .vp-window-dots i { width: 10px; height: 10px; border-radius: 999px; background: var(--surface); }
    .vp-code-card pre {
      margin: 0;
      padding: 24px 0;
      min-height: 280px;
      overflow: auto;
      color: var(--ink-soft);
      font: 14px/1.75 var(--mono);
    }
    .vp-code-card code span { display: block; padding: 0 20px; white-space: pre; }
    .vp-code-muted { color: var(--muted); }
    .vp-code-remove { background: rgba(220, 38, 38, .14); color: var(--muted); }
    .vp-code-add { background: var(--accent-soft); color: var(--ink); }
    .vp-code-sign { color: var(--success); display: inline-flex; align-items: center; gap: 6px; }
    .vp-cursor {
      display: inline-block;
      width: 1px;
      height: 1em;
      margin-left: 1px;
      background: var(--accent);
      vertical-align: -2px;
      animation: vp-blink 1s steps(1) infinite;
    }
    .vp-features-head { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; margin-bottom: 48px; }
    .vp-feature-grid, .vp-compliance-grid, .vp-belief-grid {
      display: grid;
      border-top: 0.5px solid var(--line);
      border-left: 0.5px solid var(--line);
    }
    .vp-feature-grid { grid-template-columns: repeat(3, 1fr); }
    .vp-compliance-grid { grid-template-columns: repeat(3, 1fr); }
    .vp-card {
      min-height: 180px;
      padding: 32px 28px;
      border-right: 0.5px solid var(--line);
      border-bottom: 0.5px solid var(--line);
      background: var(--row-bg);
    }
    .vp-card-num { margin-bottom: 18px; color: var(--accent); font: 11px/1 var(--mono); letter-spacing: 0.06em; }
    .vp-card h3 { margin: 0; color: var(--ink); font: 400 24px/1.15 var(--display); letter-spacing: -0.015em; }
    .vp-card p { margin: 14px 0 0; color: var(--ink-soft); font-size: 13.5px; line-height: 1.55; text-wrap: pretty; }
    .vp-belief-grid { grid-template-columns: repeat(3, 1fr); border-left: 0; }
    .vp-belief { min-height: 280px; padding: 36px 28px; border-right: 0.5px solid var(--line); }
    .vp-belief:first-child { padding-left: 0; }
    .vp-belief:last-child { border-right: 0; }
    .vp-compliance-card {
      min-height: 110px;
      padding: 24px 22px;
      border-right: 0.5px solid var(--line);
      border-bottom: 0.5px solid var(--line);
      background: var(--row-bg);
    }
    .vp-compliance-card h3 { margin: 0; font: 500 22px/1.1 var(--display); letter-spacing: -0.01em; }
    .vp-compliance-card p { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .vp-final {
      text-align: center;
      padding: 40px 0;
      border-top: 0.5px solid var(--line-strong);
      border-bottom: 0.5px solid var(--line-strong);
    }
    .vp-final h2 {
      max-width: 14ch;
      margin: 20px auto 0;
      font: 400 clamp(54px, 7vw, 112px)/0.96 var(--display);
      letter-spacing: -0.035em;
      text-wrap: balance;
    }
    .vp-final h2 em { color: var(--accent); font-style: italic; }
    .vp-final p { max-width: 610px; margin: 28px auto 0; color: var(--ink-soft); font-size: 17px; line-height: 1.55; text-wrap: pretty; }
    .vp-footer {
      background: rgba(255, 255, 255, 0.54);
      border-top: 0.5px solid var(--line);
    }
    .vp-footer-grid {
      display: grid;
      grid-template-columns: 1.5fr repeat(4, 1fr);
      gap: 48px;
      margin-bottom: 64px;
    }
    .vp-footer p { max-width: 280px; margin: 16px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
    .vp-footer h3 { margin: 0 0 14px; color: var(--muted); font: 600 10px/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; }
    .vp-footer ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; color: var(--ink-soft); font-size: 12.5px; }
    .vp-footer-bottom {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding-top: 24px;
      border-top: 0.5px solid var(--line);
      color: var(--muted);
      font: 11px/1.4 var(--mono);
      letter-spacing: 0.04em;
    }
    /* enterprise-homepage-dashboard-match */
    .vp-page,
    .vp-page * {
      letter-spacing: 0 !important;
    }
    .vp-page {
      background: var(--bg);
      color: var(--ink);
    }
    .vp-container {
      width: min(1480px, calc(100vw - 48px));
    }
    .vp-nav {
      background: #18201f;
      border-bottom: 1px solid rgba(111, 158, 213, 0.18);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .vp-nav-inner {
      min-height: 68px;
      height: auto;
      padding: 12px 0;
    }
    .vp-brand,
    .vp-mark,
    .vp-brand-title {
      color: #ffffff;
    }
    .vp-mark {
      display: none;
    }
    .vp-brand {
      gap: 0;
    }
    .vp-brand-title {
      font-size: 16px;
      font-weight: 600;
    }
    .vp-brand-sub {
      color: #6f9ed5;
      font: 400 12px/1 var(--body);
      text-transform: uppercase;
    }
    .vp-links a,
    .vp-signin {
      color: rgba(255, 255, 255, 0.70);
      font-size: 14px;
      font-weight: 400;
    }
    .vp-links a:hover,
    .vp-signin:hover {
      color: #ffffff;
    }
    .vp-btn {
      min-height: 42px;
      border-radius: 8px;
      border: 1px solid var(--line);
      font: 500 14px/1 var(--body);
      box-shadow: none;
    }
    .vp-btn.primary {
      background: var(--primary-bg);
      color: var(--accent-ink);
      border-color: var(--primary-bg);
      font-weight: 600;
    }
    .vp-btn.secondary {
      background: #ffffff;
      color: var(--ink);
      border-color: var(--line);
    }
    .vp-btn:hover {
      transform: none;
      border-color: var(--line-strong);
    }
    .vp-section {
      border-bottom: 1px solid var(--line);
      background: var(--bg);
    }
    .vp-section.surface,
    .vp-footer {
      background: #ffffff;
    }
    .vp-hero {
      padding: 28px 0 44px;
    }
    .vp-hero .vp-container {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
    }
    .vp-grid-bg,
    .vp-dateline {
      display: none;
    }
    .vp-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: auto;
      color: #3d6f5b;
      background: #ffffff;
      border: 1px solid #ccd8cf;
      border-radius: 999px;
      padding: 6px 10px;
      font: 600 11px/1.2 var(--body);
      text-transform: uppercase;
    }
    .vp-eyebrow strong,
    .vp-card-num,
    .vp-steps b {
      color: var(--accent);
      font-weight: 600;
    }
    .vp-hero-title,
    .vp-heading,
    .vp-final h2 {
      color: var(--ink);
      font-family: var(--body);
      font-size: 1.875rem !important;
      font-weight: 600;
      line-height: 2.25rem;
      max-width: 760px;
      margin-top: 16px;
      text-wrap: balance;
    }
    .vp-hero-title em,
    .vp-heading em,
    .vp-final h2 em {
      color: var(--accent);
      font-style: normal;
    }
    .vp-hero-lower,
    .vp-two-col,
    .vp-threat-layout,
    .vp-code-layout {
      gap: 20px;
    }
    .vp-hero-lower {
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }
    .vp-lede,
    .vp-copy,
    .vp-final p {
      color: var(--ink-soft);
      font-size: 14px;
      line-height: 1.75;
      font-family: var(--body);
    }
    .vp-note,
    .vp-stat-caption,
    .vp-source,
    .vp-footer p,
    .vp-footer-bottom,
    .vp-compliance-card p {
      color: var(--muted);
      font-family: var(--body);
      font-weight: 400;
    }
    .vp-feed-card,
    .vp-code-card,
    .vp-figure,
    .vp-card,
    .vp-compliance-card,
    .vp-final {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: none;
    }
    .vp-feed-card {
      padding: 8px 16px;
    }
    .vp-feed-head,
    .vp-code-head,
    .vp-code-foot,
    .vp-region,
    .vp-region-strip,
    .vp-card-num,
    .vp-footer h3 {
      color: var(--muted);
      font-family: var(--body);
      font-weight: 400;
      text-transform: uppercase;
    }
    .vp-feed-row {
      color: var(--ink);
      font-family: var(--mono);
      border-bottom: 1px solid var(--line-soft);
    }
    .vp-feed-row .accent,
    .vp-feed-row .ok,
    .vp-code-sign {
      color: var(--accent);
    }
    .vp-stat-big,
    .vp-threat-stat {
      color: var(--accent);
      font: 600 34px/1.05 var(--body);
    }
    .vp-proof-stat,
    .vp-threat-row,
    .vp-threat-row:last-child,
    .vp-mechanism-grid,
    .vp-region-strip,
    .vp-footer-bottom {
      border-color: var(--line);
    }
    .vp-threat-row p,
    .vp-card p,
    .vp-node p,
    .vp-compliance-card p,
    .vp-footer ul {
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.5;
    }
    .vp-node h3,
    .vp-card h3,
    .vp-compliance-card h3 {
      color: var(--ink);
      font: 600 17px/1.2 var(--body);
    }
    .vp-node-dot {
      background: #ffffff;
      border: 1px solid var(--line-strong);
      color: var(--accent);
      font-family: var(--body);
      font-weight: 600;
    }
    .vp-key-core,
    .vp-shard,
    .vp-region i,
    .vp-window-dots i,
    .vp-dot {
      border-color: rgba(49, 95, 149, 0.40);
      background: var(--primary-bg);
      color: var(--accent-ink);
    }
    .vp-key-glyph,
    .vp-key-glyph::before,
    .vp-key-glyph::after,
    .vp-beam,
    .vp-cursor {
      border-color: var(--accent);
      background: var(--accent);
    }
    .vp-shard {
      border: 1px solid rgba(49, 95, 149, 0.24);
      border-radius: 8px;
      font-weight: 600;
    }
    .vp-region-strip span:nth-child(-n+3) {
      color: var(--accent);
    }
    .vp-code-card .vp-code-add,
    .vp-code-add {
      background: rgba(49, 95, 149, 0.12);
      color: var(--accent);
    }
    .vp-code-card pre {
      color: #52625a;
      font-family: var(--mono);
    }
    .vp-code-muted,
    .vp-code-remove {
      color: var(--muted);
    }
    .vp-feature-grid,
    .vp-compliance-grid,
    .vp-belief-grid {
      border: 0;
      gap: 12px;
    }
    .vp-card,
    .vp-compliance-card,
    .vp-belief {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
    }
    .vp-belief {
      min-height: 220px;
      padding: 28px;
    }
    .vp-belief:first-child {
      padding-left: 28px;
    }
    .vp-final {
      padding: 32px 20px;
    }
    .vp-footer-grid {
      border-top: 1px solid var(--line);
      padding-top: 32px;
    }
    @media (min-width: 640px) {
      .vp-hero-title,
      .vp-heading,
      .vp-final h2 {
        font-size: 2.6rem !important;
        line-height: 1.1;
      }
      .vp-lede,
      .vp-copy,
      .vp-final p {
        font-size: 16px;
      }
    }
    .vp-reveal { opacity: 0; transform: translateY(18px); transition: opacity 850ms cubic-bezier(.2,.6,.2,1), transform 850ms cubic-bezier(.2,.6,.2,1); }
    .vp-reveal.visible { opacity: 1; transform: translateY(0); }
    @keyframes vp-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
    @keyframes vp-feed-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes vp-key-core { 0%, 5%, 95%, 100% { opacity: 1; } 15%, 90% { opacity: .18; } }
    @keyframes vp-region-pulse { 0%, 40% { box-shadow: 0 0 0 0 rgba(49, 95, 149, .22); } 52% { box-shadow: 0 0 0 12px rgba(49, 95, 149, .10); } 70%, 100% { box-shadow: 0 0 0 18px transparent; } }
    @keyframes vp-shard {
      0%, 5% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
      35%, 65% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot)); opacity: 1; }
      95%, 100% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
    }
    @keyframes vp-node-pulse { 0%, 50% { box-shadow: 0 0 0 0 rgba(49, 95, 149, .22); } 58% { box-shadow: 0 0 0 8px rgba(49, 95, 149, .12); } 74%, 100% { box-shadow: 0 0 0 16px transparent; } }
    @keyframes vp-beam { 0%, 60% { transform: scaleX(0); transform-origin: left; opacity: 0; } 65% { transform: scaleX(0); opacity: 1; } 85% { transform: scaleX(1); opacity: 1; } 92%, 100% { transform: scaleX(1); opacity: 0; } }
    @keyframes vp-zero-flash { 0%, 88% { background: var(--paper); } 90% { background: var(--accent-soft); } 100% { background: var(--paper); } }
    @media (max-width: 980px) {
      .vp-container { width: min(100% - 32px, 760px); }
      .vp-links { display: none; }
      .vp-brand { min-width: auto; }
      .vp-signin { display: none; }
      .vp-dateline { flex-direction: column; gap: 8px; }
      .vp-hero-title { font-size: clamp(60px, 17vw, 112px); }
      .vp-hero-lower, .vp-two-col, .vp-threat-layout, .vp-code-layout { grid-template-columns: 1fr; gap: 40px; }
      .vp-proof-stat { grid-template-columns: 1fr; }
      .vp-sticky { position: static; }
      .vp-mechanism-grid { grid-template-columns: 1fr; gap: 36px; padding: 36px 0; }
      .vp-wire, .vp-beam { display: none; }
      .vp-region-strip { grid-template-columns: 1fr; }
      .vp-feature-grid, .vp-compliance-grid, .vp-belief-grid, .vp-footer-grid { grid-template-columns: 1fr; }
      .vp-belief { border-right: 0; border-bottom: 0.5px solid var(--line); padding-left: 0; }
      .vp-threat-row { grid-template-columns: 1fr; gap: 14px; }
      .vp-code-card pre { font-size: 12px; }
      .vp-footer-bottom { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: 1ms !important; }
      .vp-reveal { opacity: 1; transform: none; }
    }
  </style>
</head>
<body>
  <div class="vp-page">
    <header class="vp-nav">
      <div class="vp-container vp-nav-inner">
        <a class="vp-brand" href="/" aria-label="VaultProof Enterprise home">
          <svg class="vp-mark" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="2" width="9" height="9" stroke="currentColor" stroke-width="1.4" fill="none"></rect>
            <rect x="13" y="2" width="9" height="9" stroke="currentColor" stroke-width="1.4" fill="none"></rect>
            <rect x="2" y="13" width="9" height="9" stroke="currentColor" stroke-width="1.4" fill="none"></rect>
            <rect x="13" y="13" width="9" height="9" fill="currentColor"></rect>
            <path d="M11.5 6.5h1M6.5 11.5v1M17.5 11.5v1M11.5 17.5h1" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"></path>
          </svg>
          <span><span class="vp-brand-title">VaultProof</span><span class="vp-brand-sub">Enterprise</span></span>
        </a>
        <nav class="vp-links" aria-label="Primary">
          <a href="#platform">Platform</a>
          <a href="#security">Security</a>
          <a href="#integrations">Integrations</a>
          <a href="#trust">Trust</a>
          <a href="/app/dashboard">Dashboard</a>
          <a href="/readiness">Readiness</a>
        </nav>
        <div class="vp-actions">
          <a class="vp-signin" href="/app/login">Sign in</a>
          <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20Enterprise%20pilot%20walkthrough">Book a walkthrough →</a>
        </div>
      </div>
    </header>

    <main>
      <section class="vp-section vp-hero" id="platform">
        <div class="vp-grid-bg" aria-hidden="true"></div>
        <div class="vp-container">
          <div class="vp-dateline" aria-label="VaultProof edition metadata">
            <span>VOL · I / ISSUE 01 · APRIL 2026</span>
            <span>VAULTPROOF · ENTERPRISE EDITION</span>
            <span>v0.9 · PRIVATE BETA</span>
          </div>
          <div class="vp-eyebrow"><strong>§ 01</strong><span>What VaultProof is</span></div>
          <h1 class="vp-hero-title">Active Key Protection<br><em>for every API call.</em></h1>
          <div class="vp-hero-lower">
            <div>
              <p class="vp-lede">VaultProof is a safe middle layer for important API keys. Your app calls VaultProof instead of storing the real key. VaultProof unlocks the key in a protected GCP runtime, uses it for one request, then erases it.</p>
              <div class="vp-cta-row">
                <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20Enterprise%20early%20access">Request early access →</a>
                <a class="vp-btn secondary" href="/app/login">Enterprise sign in</a>
              </div>
              <div class="vp-proof-stat">
                <div class="vp-stat-big" data-count="99.998" data-suffix="%">0%</div>
                <p class="vp-stat-caption">Illustrative successful safe API calls across 1.42 million requests in a 30-day test run.</p>
              </div>
            </div>
            <div>
              <div class="vp-feed-head"><span>Illustrative · safe API calls</span><span class="vp-live"><span class="vp-dot"></span>streaming</span></div>
              <div class="vp-feed-card" id="proxy-feed" aria-live="polite"></div>
              <p class="vp-note">An animated example of VaultProof protecting each request. Not real customer traffic; the live production check is available at <a href="/readiness">/readiness</a>.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal" id="security">
        <div class="vp-container vp-two-col">
          <div>
            <div class="vp-eyebrow"><span>The simple picture</span></div>
            <h2 class="vp-heading">Your app talks to <em>VaultProof</em> instead of holding keys.</h2>
            <p class="vp-copy">Think of VaultProof like a locked key room. Your app asks for an API call. VaultProof checks that the call is allowed, briefly unlocks the key in a safe place, makes the call, and locks everything back up.</p>
            <div class="vp-steps">
              <b>01</b><span>Your app sends the request to VaultProof</span>
              <b>02</b><span>VaultProof checks if the request is allowed</span>
              <b>03</b><span>The key appears only briefly in a safe machine</span>
              <b>04</b><span>VaultProof calls the provider, erases the key, and saves a receipt</span>
            </div>
          </div>
          <div class="vp-figure" aria-label="Animated key sharding diagram">
            <div class="vp-figure-grid"></div>
            <div class="vp-region" style="left:15%;top:18%"><i></i>us-east-1</div>
            <div class="vp-region" style="left:86%;top:16%"><i></i>eu-west-2</div>
            <div class="vp-region" style="left:11%;top:76%"><i></i>ap-south-1</div>
            <div class="vp-region" style="left:88%;top:78%"><i></i>us-west-2</div>
            <div class="vp-region" style="left:50%;top:86%"><i></i>eu-north-1</div>
            <div class="vp-key-core"><div class="vp-key-glyph"></div></div>
            <div class="vp-shard s1">01</div><div class="vp-shard s2">02</div><div class="vp-shard s3">03</div><div class="vp-shard s4">04</div><div class="vp-shard s5">05</div>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-container vp-threat-layout">
          <div class="vp-sticky">
            <div class="vp-eyebrow"><strong>§ 02</strong><span>Why it matters</span></div>
            <h2 class="vp-heading">API keys are like passwords for your business. <em>Do not leave them lying around.</em></h2>
          </div>
          <div>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="80" data-prefix="~" data-suffix="%">~0%</div><div><p>of breaches involve stolen or misused login details, passwords, or keys in industry reports like Verizon's DBIR.</p><div class="vp-source">— Verizon DBIR, recent years</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="4.88" data-prefix="$" data-suffix="M">$0M</div><div><p>is the average global cost of one data breach, per IBM's annual study.</p><div class="vp-source">— IBM Cost of a Data Breach Report</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat">minutes</div><div><p>is all it can take for a leaked key in GitHub, logs, a laptop, or a build system to become a real problem.</p><div class="vp-source">— Common incident pattern</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="0">0</div><div><p>raw keys should live in your app. VaultProof keeps the dangerous key out of your code, settings, logs, and database.</p><div class="vp-source">— Our operating model</div></div></article>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-two-col" style="align-items:end;margin-bottom:44px">
            <div>
              <div class="vp-eyebrow"><strong>§ 03</strong><span>How one request works</span></div>
              <h2 class="vp-heading"><em>Ask.</em> Check. Use. Erase.</h2>
            </div>
            <p class="vp-copy" style="margin:0">Your app sends a normal API request through VaultProof. VaultProof checks the request, uses the key in a safe machine, sends the provider call, then erases the key from memory.</p>
          </div>
          <div class="vp-region-strip">
            <span><i></i>1/5 · us-east-1</span><span><i></i>2/5 · eu-west-2</span><span><i></i>3/5 · ap-south-1</span><span><i></i>4/5 · us-west-2</span><span><i></i>5/5 · eu-north-1</span>
          </div>
          <div class="vp-mechanism-grid">
            <div class="vp-wire"></div><div class="vp-beam"></div>
            <article class="vp-node"><div class="vp-node-dot">01</div><div><h3>Your app</h3><p>Your app calls VaultProof instead of putting the API key in code or an env var.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">02</div><div><h3>VaultProof</h3><p>We check the rules, gather the key pieces, and unlock the key inside a protected GCP runtime.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">03</div><div><h3>Provider</h3><p>VaultProof sends the approved request to OpenAI, Stripe, Twilio, Snowflake, or another provider.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">04</div><div><h3>Receipt</h3><p>The key is erased from memory and your security team gets a record of what happened.</p></div></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal" id="integrations">
        <div class="vp-container vp-code-layout">
          <div>
            <div class="vp-eyebrow"><strong>§ 04</strong><span>How teams start</span></div>
            <h2 class="vp-heading">Keep your code. <em>Stop storing the key.</em></h2>
            <p class="vp-copy">You keep using OpenAI, Stripe, Twilio, Snowflake, and the tools you already have. The change is simple: the real key moves out of your app and into VaultProof.</p>
            <div class="vp-checklist">
              <span>Start with one important API key</span>
              <span>Keep your current provider SDKs and app logic</span>
              <span>Use Cloud KMS or a customer-owned gateway pattern when your company wants stronger custody controls</span>
              <span>Send clear request records to your security tools</span>
            </div>
          </div>
          <div class="vp-code-card">
            <div class="vp-code-head">
              <div class="vp-window-dots"><i></i><i></i><i></i></div>
              <span id="code-title">stripe.ts · git diff</span>
              <span style="color:var(--accent)">+ 1 / - 1</span>
            </div>
            <pre><code id="code-sample" aria-live="polite"></code></pre>
            <div class="vp-code-foot">
              <span>vault-id found · key used inside safe machine · memory erased</span>
              <span class="vp-code-sign"><span class="vp-dot"></span>signed audit event #<span id="audit-id">84,127,902</span></span>
            </div>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-features-head">
            <div>
              <div class="vp-eyebrow"><strong>§ 05</strong><span>What you get</span></div>
              <h2 class="vp-heading" style="font-size:48px">A safer home for API keys.</h2>
            </div>
            <a href="mailto:security@vaultproof.dev?subject=VaultProof%20architecture%20brief" style="color:var(--accent);font-weight:500;font-size:13px">Architecture brief →</a>
          </div>
          <div class="vp-feature-grid">
            <article class="vp-card"><div class="vp-card-num">01 / 06</div><h3>No raw keys in apps</h3><p>Move API keys out of code, env vars, CI logs, and app databases.</p></article>
            <article class="vp-card"><div class="vp-card-num">02 / 06</div><h3>Keys used safely</h3><p>Keys are unlocked only inside a protected GCP runtime, only when a request needs them.</p></article>
            <article class="vp-card"><div class="vp-card-num">03 / 06</div><h3>Clear rules</h3><p>Choose which project, website, provider, and customer gateway is allowed to use each key.</p></article>
            <article class="vp-card"><div class="vp-card-num">04 / 06</div><h3>Simple audit records</h3><p>Every key use creates a clear record your security team can review.</p></article>
            <article class="vp-card"><div class="vp-card-num">05 / 06</div><h3>You can own the keys</h3><p>Use Cloud KMS or a customer-owned gateway pattern when your company needs ownership and shutoff controls.</p></article>
            <article class="vp-card"><div class="vp-card-num">06 / 06</div><h3>Works with major APIs</h3><p>Protect calls to OpenAI, Stripe, Twilio, Snowflake, Datadog, and other APIs from one place.</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-grid-bg" aria-hidden="true"></div>
        <div class="vp-container" style="position:relative">
          <div class="vp-eyebrow"><strong>§ 06</strong><span>Our promise</span></div>
          <h2 class="vp-heading" style="max-width:14ch;font-size:clamp(48px,5.6vw,88px);margin-bottom:64px">Simple rules for <em>important keys.</em></h2>
          <div class="vp-belief-grid">
            <article class="vp-belief"><div class="vp-card-num">01</div><h3>Do not leave keys in apps.</h3><p>If the real key is not sitting in your app, repo, or database, attackers have less to steal.</p></article>
            <article class="vp-belief"><div class="vp-card-num">02</div><h3>Use keys only for the request.</h3><p>VaultProof unlocks keys for one approved API call at a time, not forever.</p></article>
            <article class="vp-belief"><div class="vp-card-num">03</div><h3>Show what happened.</h3><p>Every safe request leaves behind a clear record: who used what, for which provider, and when.</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal" id="trust">
        <div class="vp-container">
          <div class="vp-two-col" style="align-items:baseline;margin-bottom:32px">
            <div>
              <div class="vp-eyebrow"><strong>§ 07</strong><span>Trust · the honest version</span></div>
              <h2 class="vp-heading">We're early. <em>The guided pilot environment is live.</em></h2>
            </div>
            <p class="vp-copy" style="margin:0">VaultProof is in private beta. We do not claim certifications before auditors sign them. Today we have a live secure GCP pilot environment, a clear enterprise dashboard, and a roadmap toward the proof big companies need.</p>
          </div>
          <div class="vp-compliance-grid">
            <article class="vp-compliance-card"><h3>SOC 2 Type II</h3><p>Pursuing · Type I observation underway</p></article>
            <article class="vp-compliance-card"><h3>ISO 27001</h3><p>Gap analysis complete · audit planned</p></article>
            <article class="vp-compliance-card"><h3>HIPAA</h3><p>BAA template · architecture HIPAA-aligned</p></article>
            <article class="vp-compliance-card"><h3>GDPR</h3><p>EU data residency available · DPA on request</p></article>
            <article class="vp-compliance-card"><h3>PCI DSS</h3><p>Design-partner scope · audit planned</p></article>
            <article class="vp-compliance-card"><h3>FedRAMP</h3><p>Roadmap item · post-GA</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-final">
            <div class="vp-eyebrow" style="justify-content:center"><span>Private beta · design partners welcome</span></div>
            <h2>Start with the API key <em>you worry about most.</em></h2>
            <p>We're working with a small number of design partners while we harden the platform. Bring one important provider key, and we will help you move it out of your app and behind VaultProof.</p>
            <div class="vp-cta-row" style="justify-content:center;margin-top:40px">
              <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20Enterprise%20early%20access">Request early access</a>
              <a class="vp-btn secondary" href="/app/login">Sign in to enterprise</a>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="vp-footer">
      <div class="vp-container vp-pad" style="padding-bottom:64px">
        <div class="vp-footer-grid">
          <div>
            <div class="vp-brand" style="min-width:0"><svg class="vp-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9" height="9" stroke="currentColor" stroke-width="1.4" fill="none"></rect><rect x="13" y="2" width="9" height="9" stroke="currentColor" stroke-width="1.4" fill="none"></rect><rect x="2" y="13" width="9" height="9" stroke="currentColor" stroke-width="1.4" fill="none"></rect><rect x="13" y="13" width="9" height="9" fill="currentColor"></rect></svg><span class="vp-brand-title">VaultProof</span></div>
            <p>A safer home for enterprise API keys. Your app calls VaultProof; VaultProof safely uses the key; your app never stores the raw secret.</p>
          </div>
          <div><h3>Platform</h3><ul><li>Secure API gateway</li><li>Safe key use</li><li>Access rules</li><li>Audit records</li><li>Cloud KMS custody</li></ul></div>
          <div><h3>Resources</h3><ul><li><a href="/readiness">Readiness</a></li><li><a href="/health">Health</a></li><li><a href="/app/dashboard">Dashboard</a></li><li><a href="/app/alerts">Alerts</a></li></ul></div>
          <div><h3>Company</h3><ul><li>Private beta</li><li>Design partners</li><li>Security review</li><li>Founder-led support</li></ul></div>
          <div><h3>Contact</h3><ul><li><a href="mailto:hello@vaultproof.dev">hello@vaultproof.dev</a></li><li><a href="mailto:security@vaultproof.dev">security@vaultproof.dev</a></li><li>San Francisco, CA</li></ul></div>
        </div>
        <div class="vp-footer-bottom"><span>© 2026 VaultProof, Inc.</span><span>STATUS · <span style="color:var(--success)">BETA</span> · v0.9</span><span>Privacy · Terms · Security</span></div>
      </div>
    </footer>
  </div>

  <script>
    (function() {
      var rows = [
        { svc: 'stripe', act: 'POST /v1/charges', ms: 11 },
        { svc: 'openai', act: 'POST /v1/responses', ms: 9 },
        { svc: 'twilio', act: 'POST /Messages.json', ms: 12 },
        { svc: 'snowflake', act: 'POST /api/v2/statements', ms: 14 },
        { svc: 'datadog', act: 'POST /api/v2/logs', ms: 8 },
        { svc: 'aws-s3', act: 'PUT /reports/2026-04', ms: 10 },
        { svc: 'slack', act: 'POST /api/chat.postMessage', ms: 13 },
        { svc: 'github', act: 'POST /repos/.../dispatches', ms: 11 }
      ];
      var feed = document.getElementById('proxy-feed');
      var index = 0;
      function renderFeed() {
        if (!feed) return;
        var active = [];
        for (var i = 0; i < 5; i += 1) active.push(rows[(index + i) % rows.length]);
        feed.innerHTML = active.map(function(row) {
          return '<div class="vp-feed-row"><span><span class="accent">vp://</span>' + row.svc + '<span class="muted">' + row.act + '</span></span><span class="muted">3/5 shares</span><span class="ok">✓ ' + row.ms + 'ms</span></div>';
        }).join('');
        index = (index + 1) % rows.length;
      }
      renderFeed();
      setInterval(renderFeed, 2200);

      var services = [
        { lib: 'Stripe', pkg: 'stripe', envVar: 'STRIPE_KEY', vp: 'vp://stripe-live', ctor: 'new Stripe', call: 'charges.create' },
        { lib: 'OpenAI', pkg: 'openai', envVar: 'OPENAI_API_KEY', vp: 'vp://openai-prod', ctor: 'new OpenAI', call: 'responses.create' },
        { lib: 'Twilio', pkg: 'twilio', envVar: 'TWILIO_TOKEN', vp: 'vp://twilio-main', ctor: 'twilio', call: 'messages.create' },
        { lib: 'Snowflake', pkg: 'snowflake-sdk', envVar: 'SNOW_PASSWORD', vp: 'vp://snowflake-warehouse', ctor: 'snowflake.createConnection', call: 'execute' }
      ];
      var code = document.getElementById('code-sample');
      var title = document.getElementById('code-title');
      var serviceIndex = 0;
      function renderCodeLine(service, typed) {
        if (!code) return;
        code.innerHTML =
          '<span class="vp-code-muted">  import ' + service.lib + " from '" + service.pkg + "';</span>" +
          '<span class="vp-code-muted"> </span>' +
          '<span class="vp-code-remove"><span style="color:var(--danger);margin-right:12px">-</span>const client = ' + service.ctor + '(process.env.' + service.envVar + ');</span>' +
          '<span class="vp-code-add"><span style="color:var(--accent);margin-right:12px">+</span>const client = ' + service.ctor + "('" + typed + '<span class="vp-cursor"></span>' + "');</span>" +
          '<span class="vp-code-muted"> </span>' +
          '<span class="vp-code-muted">  // your existing code is unchanged</span>' +
          '<span class="vp-code-muted">  await client.' + service.call + '({ /* ... */ });</span>';
      }
      function cycleCode() {
        var service = services[serviceIndex % services.length];
        serviceIndex += 1;
        if (title) title.textContent = service.pkg + '.ts · git diff';
        var target = service.vp;
        var pos = 0;
        renderCodeLine(service, '');
        var typer = setInterval(function() {
          pos += 1;
          renderCodeLine(service, target.slice(0, pos));
          if (pos >= target.length) clearInterval(typer);
        }, 55);
      }
      cycleCode();
      setInterval(cycleCode, 5200);

      var audit = document.getElementById('audit-id');
      var auditId = 84127902;
      setInterval(function() {
        auditId += 1 + Math.floor(Math.random() * 3);
        if (audit) audit.textContent = auditId.toLocaleString();
      }, 1200);

      var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
      function animateCounter(el) {
        if (el.dataset.done === 'true') return;
        el.dataset.done = 'true';
        var target = parseFloat(el.dataset.count || '0');
        var prefix = el.dataset.prefix || '';
        var suffix = el.dataset.suffix || '';
        var decimalPart = String(el.dataset.count || '').split('.')[1] || '';
        var decimals = decimalPart.length;
        var start = performance.now();
        function tick(now) {
          var p = Math.min(1, (now - start) / 1500);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('visible');
          if (entry.target.matches('[data-count]')) animateCounter(entry.target);
          entry.target.querySelectorAll && entry.target.querySelectorAll('[data-count]').forEach(animateCounter);
        });
      }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
      document.querySelectorAll('.vp-reveal, [data-count]').forEach(function(el) { io.observe(el); });
      document.querySelectorAll('.vp-reveal').forEach(function(el, i) { el.style.transitionDelay = Math.min(i * 60, 360) + 'ms'; });

      var grid = document.querySelector('.vp-grid-bg');
      if (grid) {
        window.addEventListener('scroll', function() {
          var y = (window.scrollY || 0) * -0.025;
          grid.style.setProperty('--grid-y', y + 'px');
        }, { passive: true });
      }
    })();
  </script>
</body>
</html>`;

  return injectEnterpriseAnalytics(html, env, 'homepage');
}
