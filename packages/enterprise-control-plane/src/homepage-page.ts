import type { EnterpriseControlPlaneEnv } from './config.js';
import { injectEnterpriseAnalytics } from './analytics.js';

export function renderEnterpriseHomepage(env: EnterpriseControlPlaneEnv = {}): string {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VaultProof Enterprise | Runtime API key protection</title>
  <meta name="description" content="VaultProof Enterprise helps security and platform teams keep raw provider keys out of applications, agents, CI, and logs while preserving policy controls and audit evidence for approved API calls." />
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b10;
      --paper: #0b1118;
      --surface: #101821;
      --card-bg: rgba(14, 22, 31, 0.88);
      --row-bg: rgba(16, 24, 33, 0.76);
      --ink: #f6fbff;
      --ink-soft: #c7d3df;
      --muted: #8997a5;
      --line: rgba(248, 250, 252, 0.12);
      --line-strong: rgba(138, 180, 248, 0.30);
      --line-soft: rgba(248, 250, 252, 0.08);
      --accent: #6ee7c8;
      --accent-ink: #06100d;
      --accent-soft: rgba(110, 231, 200, 0.12);
      --primary-bg: #f6fbff;
      --success: #6ee7c8;
      --danger: #fb7185;
      --blue: #8ab4f8;
      --shadow: 0 28px 84px rgba(0, 0, 0, 0.38);
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
      overflow-x: hidden;
    }
    a { color: inherit; text-decoration: none; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .vp-page { min-height: 100vh; overflow: hidden; }
    .vp-container { width: min(1280px, calc(100vw - 48px)); margin: 0 auto; }
    .vp-nav {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(11, 15, 20, 0.90);
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
      border-radius: 8px;
      border: 0.5px solid var(--line);
      font: 500 14px/1 var(--body);
      transition: transform 180ms ease, background 180ms ease, color 180ms ease, border-color 180ms ease;
    }
    .vp-btn:hover { transform: translateY(-1px); }
    .vp-btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 650; }
    .vp-btn.secondary { background: var(--surface); color: var(--ink); }
    .vp-section { border-bottom: 0.5px solid var(--line); position: relative; }
    .vp-section.surface { background: var(--paper); }
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
      background-image: radial-gradient(rgba(168, 179, 194, 0.10) 1px, transparent 1px);
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
      font: 400 92px/0.92 var(--display);
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
      font: 400 56px/1 var(--display);
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
      box-shadow: 0 1px 0 rgba(248,250,252,.06) inset, var(--shadow);
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
      box-shadow: 0 0 0 0 rgba(138, 180, 248, .24);
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
      background: var(--surface);
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
      box-shadow: 0 1px 0 rgba(248,250,252,.06) inset, var(--shadow);
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
      font: 400 72px/0.96 var(--display);
      letter-spacing: -0.035em;
      text-wrap: balance;
    }
    .vp-final h2 em { color: var(--accent); font-style: italic; }
    .vp-final p { max-width: 610px; margin: 28px auto 0; color: var(--ink-soft); font-size: 17px; line-height: 1.55; text-wrap: pretty; }
    .vp-footer {
      background: var(--paper);
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
    body {
      background: #0b0f14;
    }
    .vp-page {
      position: relative;
      isolation: isolate;
      background:
        radial-gradient(circle at 12% 18%, rgba(138, 180, 248, 0.12), transparent 30rem),
        radial-gradient(circle at 88% 16%, rgba(138, 180, 248, 0.08), transparent 28rem),
        linear-gradient(180deg, #0b0f14 0%, #0d1219 50%, #0b0f14 100%);
      color: var(--ink);
    }
    .vp-page::before,
    .vp-page::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: -1;
    }
    .vp-page::before {
      opacity: 0.72;
      background-image:
        linear-gradient(90deg, rgba(138, 180, 248, 0.08) 1px, transparent 1px),
        linear-gradient(0deg, rgba(248, 250, 252, 0.035) 1px, transparent 1px),
        linear-gradient(35deg, transparent 47%, rgba(138, 180, 248, 0.16) 47.2%, rgba(138, 180, 248, 0.16) 47.55%, transparent 47.8%),
        linear-gradient(138deg, transparent 54%, rgba(248, 250, 252, 0.08) 54.2%, rgba(248, 250, 252, 0.08) 54.5%, transparent 54.8%);
      background-size: 420px 420px, 140px 140px, 760px 760px, 620px 620px;
      background-position: center top, center top, 18% 0, 72% 12%;
      mask-image: radial-gradient(ellipse at 56% 28%, black 0%, transparent 70%);
      -webkit-mask-image: radial-gradient(ellipse at 56% 28%, black 0%, transparent 70%);
    }
    .vp-page::after {
      opacity: 0.22;
      background-image: linear-gradient(rgba(248, 250, 252, 0.08) 1px, transparent 1px);
      background-size: 100% 7px;
      mix-blend-mode: screen;
    }
    .vp-nav,
    main,
    .vp-footer {
      position: relative;
      z-index: 1;
    }
    .vp-container {
      width: min(1220px, calc(100vw - 48px));
    }
    .vp-nav {
      background: rgba(11, 15, 20, 0.74);
      border-bottom: 1px solid rgba(138, 180, 248, 0.12);
      -webkit-backdrop-filter: blur(18px);
      backdrop-filter: blur(18px);
    }
    .vp-nav-inner {
      min-height: 74px;
      height: auto;
      padding: 12px 0;
    }
    .vp-brand {
      gap: 12px;
      min-width: 240px;
      color: var(--ink);
    }
    .vp-brand-title {
      color: var(--ink);
      font-size: 15px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .vp-brand-sub {
      color: var(--accent);
      font: 600 11px/1 var(--mono);
      text-transform: uppercase;
    }
    .vp-links a,
    .vp-signin {
      color: rgba(248, 250, 252, 0.68);
      font: 700 12px/1 var(--body);
    }
    .vp-links a:hover,
    .vp-signin:hover {
      color: var(--ink);
    }
    .vp-btn {
      min-height: 46px;
      border-radius: 8px;
      border: 1px solid rgba(248, 250, 252, 0.18);
      font: 800 12px/1 var(--mono);
      box-shadow: none;
      text-transform: uppercase;
    }
    .vp-btn.primary {
      background: var(--primary-bg);
      color: var(--accent-ink);
      border-color: var(--primary-bg);
      font-weight: 800;
    }
    .vp-btn.secondary {
      background: rgba(11, 15, 20, 0.66);
      color: var(--ink);
      border-color: rgba(248, 250, 252, 0.18);
    }
    .vp-btn:hover {
      transform: none;
      border-color: var(--line-strong);
    }
    .vp-section {
      overflow: hidden;
      border-bottom: 1px solid rgba(248, 250, 252, 0.08);
      background: rgba(11, 15, 20, 0.90);
    }
    .vp-section.surface,
    .vp-footer {
      background: rgba(17, 24, 39, 0.94);
    }
    .vp-hero {
      min-height: calc(100vh - 74px);
      display: grid;
      align-items: center;
      padding: 112px 0 94px;
    }
    .vp-hero .vp-container {
      position: relative;
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 0;
    }
    .vp-grid-bg {
      display: block;
      opacity: 0.85;
      background-image:
        linear-gradient(90deg, rgba(138, 180, 248, 0.10) 1px, transparent 1px),
        linear-gradient(0deg, rgba(248, 250, 252, 0.04) 1px, transparent 1px),
        linear-gradient(41deg, transparent 46%, rgba(138, 180, 248, 0.20) 46.1%, rgba(138, 180, 248, 0.20) 46.35%, transparent 46.55%),
        linear-gradient(132deg, transparent 55%, rgba(248, 250, 252, 0.10) 55.1%, rgba(248, 250, 252, 0.10) 55.35%, transparent 55.55%);
      background-size: 260px 260px, 92px 92px, 780px 780px, 640px 640px;
      mask-image: radial-gradient(ellipse at center, black 18%, transparent 76%);
      -webkit-mask-image: radial-gradient(ellipse at center, black 18%, transparent 76%);
    }
    .vp-dateline {
      display: flex;
      max-width: 840px;
      margin: 0 0 34px;
      padding: 0 0 15px;
      border-bottom: 1px solid rgba(248, 250, 252, 0.09);
      color: rgba(248, 250, 252, 0.42);
    }
    .vp-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: auto;
      color: var(--accent);
      background: rgba(138, 180, 248, 0.07);
      border: 1px solid rgba(138, 180, 248, 0.28);
      border-radius: 8px;
      padding: 8px 12px;
      font: 800 11px/1.2 var(--mono);
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
      font-weight: 850;
      line-height: 0.96;
      margin-top: 16px;
      text-wrap: balance;
    }
    .vp-hero-title {
      max-width: 920px;
      font-size: 82px !important;
      line-height: 0.9;
    }
    .vp-heading {
      max-width: 780px;
      font-size: 56px;
    }
    .vp-final h2 {
      font-size: 72px;
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
      gap: clamp(28px, 5vw, 72px);
    }
    .vp-hero-lower {
      grid-template-columns: minmax(0, 0.92fr) minmax(380px, 0.78fr);
      align-items: center;
      margin-top: 34px;
      padding-top: 0;
      border-top: 0;
    }
    .vp-lede,
    .vp-copy,
    .vp-final p {
      color: var(--ink-soft);
      font-size: 16px;
      line-height: 1.7;
      font-family: var(--body);
    }
    .vp-lede {
      max-width: 640px;
      font-size: 18px;
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
      background: rgba(17, 24, 39, 0.82);
      border: 1px solid rgba(248, 250, 252, 0.13);
      border-radius: 8px;
      box-shadow: 0 22px 80px rgba(0, 0, 0, 0.40);
    }
    .vp-feed-card {
      position: relative;
      padding: 48px 20px 12px;
      background:
        linear-gradient(180deg, rgba(248, 250, 252, 0.035), transparent 46%),
        rgba(11, 15, 20, 0.90);
    }
    .vp-feed-card::before {
      content: "";
      position: absolute;
      top: 18px;
      left: 18px;
      width: 42px;
      height: 10px;
      background:
        radial-gradient(circle at 5px 5px, #f87171 0 4px, transparent 4.5px),
        radial-gradient(circle at 20px 5px, #fbbf24 0 4px, transparent 4.5px),
        radial-gradient(circle at 35px 5px, var(--accent) 0 4px, transparent 4.5px);
    }
    .vp-feed-card::after {
      content: "";
      position: absolute;
      top: 39px;
      left: 0;
      right: 0;
      border-top: 1px solid rgba(248, 250, 252, 0.08);
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
      font: 850 40px/1 var(--body);
    }
    .vp-proof-stat {
      max-width: 620px;
      margin-top: 42px;
      padding-top: 26px;
      border-top: 1px solid rgba(248, 250, 252, 0.10);
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
      font: 800 20px/1.16 var(--body);
    }
    .vp-pad {
      padding: clamp(84px, 10vw, 136px) 0;
    }
    .vp-two-col {
      grid-template-columns: minmax(0, 0.88fr) minmax(420px, 1.12fr);
    }
    .vp-figure {
      border-color: rgba(138, 180, 248, 0.18);
      background:
        radial-gradient(circle at 58% 42%, rgba(138, 180, 248, 0.16), transparent 18rem),
        rgba(17, 24, 39, 0.80);
    }
    .vp-figure-grid {
      opacity: 0.78;
      background-image:
        linear-gradient(rgba(138, 180, 248, 0.10) 1px, transparent 1px),
        linear-gradient(90deg, rgba(248, 250, 252, 0.06) 1px, transparent 1px),
        linear-gradient(35deg, transparent 48%, rgba(138, 180, 248, 0.12) 48.2%, transparent 48.5%);
      background-size: 52px 52px, 52px 52px, 440px 440px;
    }
    .vp-node-dot {
      background: rgba(138, 180, 248, 0.06);
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
      border-color: rgba(138, 180, 248, 0.40);
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
      border: 1px solid rgba(138, 180, 248, 0.24);
      border-radius: 6px;
      font-weight: 600;
    }
    .vp-region-strip span:nth-child(-n+3) {
      color: var(--accent);
    }
    .vp-code-card .vp-code-add,
    .vp-code-add {
      background: rgba(138, 180, 248, 0.12);
      color: var(--accent);
    }
    .vp-code-card pre {
      color: var(--ink-soft);
      font-family: var(--mono);
    }
    .vp-code-muted,
    .vp-code-remove {
      color: var(--muted);
    }
    .vp-feature-grid,
    .vp-compliance-grid,
    .vp-belief-grid {
      border-top: 0;
      border-left: 0;
      gap: 16px;
    }
    .vp-card,
    .vp-compliance-card,
    .vp-belief {
      border: 1px solid rgba(248, 250, 252, 0.13);
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.70);
      box-shadow: none;
    }
    .vp-belief {
      min-height: 220px;
      padding: 34px;
    }
    .vp-belief:first-child {
      padding-left: 34px;
    }
    .vp-final {
      padding: clamp(48px, 8vw, 86px) 24px;
      background:
        radial-gradient(circle at 50% 0%, rgba(138, 180, 248, 0.13), transparent 28rem),
        rgba(17, 24, 39, 0.82);
    }
    .vp-footer {
      background: #0b0f14;
    }
    .vp-footer-grid {
      border-top: 1px solid var(--line);
      padding-top: 32px;
    }
    @media (max-width: 980px) {
      .vp-container { width: min(100% - 32px, 760px); }
      .vp-nav-inner { min-height: 66px; }
      .vp-links { display: none; }
      .vp-brand { min-width: auto; }
      .vp-signin { display: none; }
      .vp-hero { min-height: auto; padding: 72px 0 76px; }
      .vp-dateline { flex-direction: column; gap: 8px; }
      .vp-hero-title { font-size: 46px !important; }
      .vp-hero-lower,
      .vp-two-col,
      .vp-threat-layout,
      .vp-code-layout {
        grid-template-columns: 1fr;
        gap: 38px;
      }
      .vp-proof-stat { grid-template-columns: 1fr; }
      .vp-sticky { position: static; }
      .vp-mechanism-grid { grid-template-columns: 1fr; gap: 36px; padding: 36px 0; }
      .vp-wire, .vp-beam { display: none; }
      .vp-region-strip { grid-template-columns: 1fr; }
      .vp-feature-grid, .vp-compliance-grid, .vp-belief-grid, .vp-footer-grid { grid-template-columns: 1fr; }
      .vp-belief { border: 1px solid var(--line); padding-left: 34px; }
      .vp-threat-row { grid-template-columns: 1fr; gap: 14px; }
      .vp-code-card pre { font-size: 12px; }
      .vp-footer-bottom { flex-direction: column; }
    }
    .vp-reveal { opacity: 0; transform: translateY(18px); transition: opacity 850ms cubic-bezier(.2,.6,.2,1), transform 850ms cubic-bezier(.2,.6,.2,1); }
    .vp-reveal.visible { opacity: 1; transform: translateY(0); }
    @keyframes vp-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
    @keyframes vp-feed-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes vp-key-core { 0%, 5%, 95%, 100% { opacity: 1; } 15%, 90% { opacity: .18; } }
    @keyframes vp-region-pulse { 0%, 40% { box-shadow: 0 0 0 0 rgba(138, 180, 248, .22); } 52% { box-shadow: 0 0 0 12px rgba(138, 180, 248, .10); } 70%, 100% { box-shadow: 0 0 0 18px transparent; } }
    @keyframes vp-shard {
      0%, 5% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
      35%, 65% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot)); opacity: 1; }
      95%, 100% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
    }
    @keyframes vp-node-pulse { 0%, 50% { box-shadow: 0 0 0 0 rgba(138, 180, 248, .22); } 58% { box-shadow: 0 0 0 8px rgba(138, 180, 248, .12); } 74%, 100% { box-shadow: 0 0 0 16px transparent; } }
    @keyframes vp-beam { 0%, 60% { transform: scaleX(0); transform-origin: left; opacity: 0; } 65% { transform: scaleX(0); opacity: 1; } 85% { transform: scaleX(1); opacity: 1; } 92%, 100% { transform: scaleX(1); opacity: 0; } }
    @keyframes vp-zero-flash { 0%, 88% { background: var(--paper); } 90% { background: var(--accent-soft); } 100% { background: var(--paper); } }
    @media (max-width: 980px) {
      .vp-container { width: min(100% - 32px, 760px); }
      .vp-links { display: none; }
      .vp-brand { min-width: auto; }
      .vp-signin { display: none; }
      .vp-dateline { flex-direction: column; gap: 8px; }
      .vp-hero-title { font-size: 46px; }
      .vp-hero-lower, .vp-two-col, .vp-threat-layout, .vp-code-layout { grid-template-columns: 1fr; gap: 40px; }
      .vp-proof-stat { grid-template-columns: 1fr; }
      .vp-sticky { position: static; }
      .vp-mechanism-grid { grid-template-columns: 1fr; gap: 36px; padding: 36px 0; }
      .vp-wire, .vp-beam { display: none; }
      .vp-region-strip { grid-template-columns: 1fr; }
      .vp-feature-grid, .vp-compliance-grid, .vp-belief-grid, .vp-footer-grid { grid-template-columns: 1fr; }
      .vp-belief { border: 1px solid var(--line); padding-left: 0; }
      .vp-threat-row { grid-template-columns: 1fr; gap: 14px; }
      .vp-code-card pre { font-size: 12px; }
      .vp-footer-bottom { flex-direction: column; }
    }
    /* enterprise-homepage-business-match */
    body {
      background: var(--bg);
      color: var(--ink);
      font-size: 16px;
      font-weight: 430;
    }
    .vp-page {
      background:
        linear-gradient(180deg, #070b10 0%, #0a1017 42%, #070b10 100%);
      color: var(--ink);
    }
    .vp-page::before {
      opacity: 0.56;
      background-image:
        linear-gradient(90deg, rgba(138, 180, 248, 0.09) 1px, transparent 1px),
        linear-gradient(0deg, rgba(248, 250, 252, 0.045) 1px, transparent 1px),
        linear-gradient(145deg, transparent 48%, rgba(110, 231, 200, 0.12) 48.15%, transparent 48.45%);
      background-size: 86px 86px, 86px 86px, 760px 760px;
      mask-image: linear-gradient(to bottom, black 0%, transparent 78%);
      -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 78%);
    }
    .vp-page::after {
      display: block;
      opacity: 0.10;
      background-image: linear-gradient(rgba(248, 250, 252, 0.12) 1px, transparent 1px);
      background-size: 100% 9px;
      mix-blend-mode: screen;
    }
    .vp-container {
      width: min(1180px, calc(100vw - 72px));
    }
    .vp-nav {
      background: rgba(7, 11, 16, 0.84);
      border-bottom: 1px solid var(--line);
      -webkit-backdrop-filter: blur(18px);
      backdrop-filter: blur(18px);
    }
    .vp-nav-inner {
      min-height: 58px;
      padding: 0;
    }
    .vp-brand {
      min-width: 230px;
      color: var(--ink);
    }
    .vp-brand-title {
      color: var(--ink);
      font-size: 15px;
      font-weight: 760;
      text-transform: none;
    }
    .vp-brand-sub {
      color: var(--accent);
      font: 650 11px/1 var(--mono);
      text-transform: uppercase;
    }
    .vp-links {
      gap: 24px;
    }
    .vp-links a,
    .vp-signin {
      color: rgba(246, 251, 255, 0.72);
      font: 560 13px/1 var(--body);
      text-transform: none;
    }
    .vp-links a:hover,
    .vp-signin:hover {
      color: var(--ink);
    }
    .vp-btn {
      min-height: 38px;
      padding: 0 15px;
      border-radius: 4px;
      border: 1px solid var(--line);
      font: 680 13px/1 var(--body);
      text-transform: none;
      box-shadow: none;
    }
    .vp-btn.primary {
      background: var(--primary-bg);
      color: #071018;
      border-color: rgba(246, 251, 255, 0.88);
    }
    .vp-btn.secondary {
      background: rgba(16, 24, 33, 0.78);
      color: var(--ink);
      border-color: var(--line);
    }
    .vp-btn.secondary:hover {
      background: rgba(20, 31, 43, 0.92);
    }
    .vp-section {
      background: rgba(7, 11, 16, 0.34);
      border-bottom: 1px solid var(--line);
    }
    .vp-section.surface,
    .vp-footer {
      background: rgba(10, 16, 23, 0.82);
    }
    .vp-pad {
      padding: 92px 0;
    }
    .vp-hero {
      min-height: auto;
      padding: 92px 0 86px;
    }
    .vp-grid-bg {
      opacity: 0.42;
      background-image:
        linear-gradient(90deg, rgba(138, 180, 248, 0.12) 1px, transparent 1px),
        linear-gradient(0deg, rgba(248, 250, 252, 0.055) 1px, transparent 1px);
      background-size: 96px 96px;
      mask-image: radial-gradient(ellipse at center, black 22%, transparent 72%);
      -webkit-mask-image: radial-gradient(ellipse at center, black 22%, transparent 72%);
    }
    .vp-dateline {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      max-width: none;
      margin: 0 0 34px;
      padding: 0 0 14px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font: 650 11px/1.35 var(--mono);
    }
    .vp-dateline span:nth-child(2) {
      text-align: center;
    }
    .vp-dateline span:last-child {
      text-align: right;
    }
    .vp-eyebrow {
      display: inline-flex;
      gap: 8px;
      width: auto;
      padding: 7px 10px;
      border: 1px solid rgba(110, 231, 200, 0.26);
      border-radius: 4px;
      background: rgba(110, 231, 200, 0.08);
      color: var(--accent);
      font: 750 11px/1.2 var(--mono);
      text-transform: uppercase;
    }
    .vp-eyebrow strong,
    .vp-card-num,
    .vp-steps b {
      color: var(--accent);
      font-weight: 750;
    }
    .vp-hero-title,
    .vp-heading,
    .vp-final h2 {
      color: var(--ink);
      font-family: var(--display);
      font-weight: 760;
      letter-spacing: -0.02em !important;
      line-height: 1;
      text-wrap: balance;
    }
    .vp-hero-title {
      max-width: 990px;
      margin-top: 18px;
      font-size: 72px !important;
      line-height: 0.97;
    }
    .vp-heading {
      max-width: 780px;
      font-size: 48px;
      line-height: 1.02;
    }
    .vp-final h2 {
      max-width: 820px;
      font-size: 58px;
      line-height: 1.02;
    }
    .vp-hero-title em,
    .vp-heading em,
    .vp-final h2 em {
      color: var(--accent);
      font-style: normal;
    }
    .vp-hero-lower {
      grid-template-columns: minmax(0, 1fr) minmax(380px, 0.72fr);
      gap: 46px;
      margin-top: 38px;
      padding-top: 0;
      border-top: 0;
      align-items: start;
    }
    .vp-two-col,
    .vp-threat-layout,
    .vp-code-layout {
      gap: 56px;
    }
    .vp-lede,
    .vp-copy,
    .vp-final p {
      color: var(--ink-soft);
      font-family: var(--body);
      font-size: 17px;
      line-height: 1.66;
    }
    .vp-lede {
      max-width: 660px;
      font-size: 18px;
    }
    .vp-note,
    .vp-stat-caption,
    .vp-source,
    .vp-footer p,
    .vp-footer-bottom,
    .vp-compliance-card p {
      color: var(--muted);
      font-family: var(--body);
      font-weight: 430;
    }
    .vp-proof-stat {
      max-width: 560px;
      grid-template-columns: 110px minmax(0, 1fr);
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
    }
    .vp-stat-big,
    .vp-threat-stat {
      color: var(--accent);
      font: 760 42px/1 var(--body);
      letter-spacing: -0.015em !important;
    }
    .vp-stat-caption {
      font: 13px/1.5 var(--body);
      letter-spacing: 0 !important;
    }
    .vp-feed-head,
    .vp-code-head,
    .vp-code-foot,
    .vp-region,
    .vp-region-strip,
    .vp-card-num,
    .vp-footer h3 {
      color: var(--muted);
      font-family: var(--mono);
      font-weight: 650;
      text-transform: uppercase;
    }
    .vp-feed-card,
    .vp-code-card,
    .vp-figure,
    .vp-card,
    .vp-compliance-card,
    .vp-belief,
    .vp-final {
      background: var(--card-bg);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
    }
    .vp-feed-card {
      padding: 46px 18px 10px;
      background:
        linear-gradient(180deg, rgba(246, 251, 255, 0.045), transparent 42%),
        rgba(9, 14, 20, 0.92);
    }
    .vp-feed-row {
      color: var(--ink);
      border-bottom: 1px solid var(--line-soft);
      font-family: var(--mono);
    }
    .vp-feed-row .muted,
    .vp-code-muted,
    .vp-code-remove {
      color: rgba(246, 251, 255, 0.55);
    }
    .vp-feed-row .accent,
    .vp-feed-row .ok,
    .vp-code-sign,
    .vp-code-add {
      color: var(--accent);
    }
    .vp-code-card .vp-code-add,
    .vp-code-add {
      background: var(--accent-soft);
    }
    .vp-code-card pre {
      color: rgba(246, 251, 255, 0.80);
      font-family: var(--mono);
    }
    .vp-figure {
      background:
        linear-gradient(180deg, rgba(110, 231, 200, 0.075), transparent 46%),
        rgba(14, 22, 31, 0.86);
      border-color: rgba(138, 180, 248, 0.18);
    }
    .vp-figure-grid {
      opacity: 0.76;
      background-image:
        linear-gradient(rgba(138, 180, 248, 0.09) 1px, transparent 1px),
        linear-gradient(90deg, rgba(248, 250, 252, 0.055) 1px, transparent 1px);
      background-size: 52px 52px;
    }
    .vp-key-core,
    .vp-shard,
    .vp-region i,
    .vp-window-dots i,
    .vp-dot {
      border-color: rgba(110, 231, 200, 0.34);
      background: var(--accent);
      color: #071018;
    }
    .vp-key-glyph,
    .vp-key-glyph::before,
    .vp-key-glyph::after,
    .vp-beam,
    .vp-cursor {
      border-color: var(--accent);
      background: var(--accent);
    }
    .vp-region-strip {
      border-bottom: 1px dashed var(--line);
    }
    .vp-node-dot {
      background: rgba(246, 251, 255, 0.045);
      border: 1px solid var(--line-strong);
      color: var(--accent);
      font-family: var(--mono);
      font-weight: 750;
    }
    .vp-node h3,
    .vp-card h3,
    .vp-compliance-card h3,
    .vp-belief h3 {
      color: var(--ink);
      font: 750 20px/1.2 var(--body);
      letter-spacing: -0.01em !important;
    }
    .vp-threat-row,
    .vp-mechanism-grid,
    .vp-footer-bottom {
      border-color: var(--line);
    }
    .vp-threat-row p,
    .vp-card p,
    .vp-node p,
    .vp-compliance-card p,
    .vp-belief p,
    .vp-footer ul {
      color: var(--ink-soft);
      font-size: 14px;
      line-height: 1.56;
    }
    .vp-feature-grid,
    .vp-compliance-grid,
    .vp-belief-grid {
      gap: 16px;
      border: 0;
    }
    .vp-card,
    .vp-compliance-card,
    .vp-belief {
      min-height: auto;
      padding: 28px;
      background: rgba(14, 22, 31, 0.78);
      box-shadow: none;
    }
    .vp-belief:first-child {
      padding-left: 28px;
    }
    .vp-final {
      padding: 58px 34px;
      background:
        linear-gradient(180deg, rgba(246, 251, 255, 0.055), rgba(110, 231, 200, 0.045)),
        rgba(14, 22, 31, 0.88);
    }
    .vp-footer {
      background: #070b10;
      border-top: 1px solid var(--line);
    }
    .vp-footer-grid {
      border-top: 1px solid var(--line);
      padding-top: 32px;
    }
    @media (max-width: 980px) {
      .vp-container {
        width: min(100% - 32px, 760px);
      }
      .vp-nav-inner {
        min-height: 58px;
      }
      .vp-brand {
        min-width: auto;
      }
      .vp-links,
      .vp-signin {
        display: none;
      }
      .vp-hero {
        padding: 68px 0 72px;
      }
      .vp-dateline {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .vp-dateline span,
      .vp-dateline span:nth-child(2),
      .vp-dateline span:last-child {
        text-align: left;
      }
      .vp-hero-title {
        font-size: 44px !important;
      }
      .vp-heading {
        font-size: 34px;
      }
      .vp-final h2 {
        font-size: 36px;
      }
      .vp-hero-lower,
      .vp-two-col,
      .vp-threat-layout,
      .vp-code-layout {
        grid-template-columns: 1fr;
        gap: 36px;
      }
      .vp-pad {
        padding: 64px 0;
      }
      .vp-proof-stat {
        grid-template-columns: 1fr;
      }
      .vp-feature-grid,
      .vp-compliance-grid,
      .vp-belief-grid,
      .vp-footer-grid {
        grid-template-columns: 1fr;
      }
      .vp-card,
      .vp-compliance-card,
      .vp-belief {
        padding: 22px;
      }
      .vp-belief:first-child {
        padding-left: 22px;
      }
    }
    .vp-logo-icon {
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      color: #06100d;
      background: linear-gradient(135deg, #76ebd0, #4fb39b);
      box-shadow: 0 0 0 1px rgba(118, 235, 208, 0.42), 0 14px 28px -16px rgba(118, 235, 208, 0.88);
    }
    .vp-logo-icon svg {
      width: 15px;
      height: 15px;
      display: block;
    }
    .vp-preview-hero {
      min-height: auto;
      padding: 132px 0 0;
      background:
        radial-gradient(circle at 9% 9%, rgba(118, 235, 208, 0.17), transparent 27rem),
        radial-gradient(circle at 84% 25%, rgba(244, 184, 96, 0.10), transparent 30rem),
        #06090e;
    }
    .vp-preview-hero .vp-grid-bg {
      opacity: 0.52;
      inset: 0;
      background-image: radial-gradient(rgba(248, 250, 252, 0.11) 1px, transparent 1px);
      background-size: 24px 24px;
      mask-image: radial-gradient(ellipse at top center, black 22%, transparent 78%);
      -webkit-mask-image: radial-gradient(ellipse at top center, black 22%, transparent 78%);
    }
    .vp-hero-center {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .vp-hero-center .vp-hero-title {
      max-width: 1000px;
      margin: 0;
      color: #eaeff5;
      font: 650 clamp(58px, 7vw, 90px)/0.96 var(--display);
      letter-spacing: -0.035em !important;
    }
    .vp-hero-center .vp-serif {
      font-family: Georgia, "Times New Roman", serif;
      font-style: italic;
      font-weight: 400;
      letter-spacing: -0.02em !important;
    }
    .vp-hero-center .vp-mint { color: #76ebd0; }
    .vp-hero-center .vp-gold { color: #f4b860; }
    .vp-hero-copy {
      max-width: 650px;
      margin: 28px auto 0;
      color: #a1abb8;
      font-size: 16.5px;
      line-height: 1.65;
      text-wrap: pretty;
    }
    .vp-preview-hero .vp-cta-row {
      justify-content: center;
      margin-top: 34px;
    }
    .vp-preview-hero .vp-btn {
      min-height: 44px;
      border-radius: 999px;
      padding: 0 18px;
      font: 600 14px/1 var(--body);
      text-transform: none;
      letter-spacing: 0 !important;
    }
    .vp-preview-hero .vp-btn.primary {
      background: #76ebd0;
      border-color: rgba(118, 235, 208, 0.75);
      box-shadow: 0 18px 36px -24px rgba(118, 235, 208, 0.95);
    }
    .vp-preview-hero .vp-btn.secondary {
      background: rgba(6, 9, 14, 0.46);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .vp-hero-points {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 22px;
      margin-top: 28px;
      color: #6b7585;
      font: 12px/1 var(--mono);
    }
    .vp-hero-points span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .vp-hero-points i {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #76ebd0;
      box-shadow: 0 0 0 3px rgba(118, 235, 208, 0.10);
    }
    .vp-dashboard-preview {
      position: relative;
      z-index: 1;
      width: min(1120px, 100%);
      margin: 78px auto 0;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      background: #0a0e13;
      box-shadow: 0 42px 110px -62px rgba(118, 235, 208, 0.8), 0 34px 90px rgba(0, 0, 0, 0.38);
    }
    .vp-dashboard-preview::before {
      content: "";
      position: absolute;
      inset: -48px;
      z-index: -1;
      background: radial-gradient(60% 60% at 50% 20%, rgba(118, 235, 208, 0.18), transparent 70%);
    }
    .vp-chrome-bar {
      min-height: 48px;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 18px;
      padding: 0 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: #11181f;
    }
    .vp-chrome-dots {
      display: flex;
      gap: 8px;
    }
    .vp-chrome-dots i {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
    }
    .vp-url-chip,
    .vp-live-chip,
    .vp-period {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.03);
      color: #6b7585;
      font: 11px/1 var(--mono);
      padding: 7px 10px;
      white-space: nowrap;
    }
    .vp-live-chip {
      justify-self: end;
      color: #76ebd0;
      border-color: rgba(118, 235, 208, 0.25);
      background: rgba(118, 235, 208, 0.07);
    }
    .vp-dashboard-body {
      padding: 22px 24px 18px;
    }
    .vp-dashboard-top {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    .vp-dashboard-label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 12px;
      padding: 6px 9px;
      border: 1px solid rgba(118, 235, 208, 0.24);
      border-radius: 7px;
      color: #76ebd0;
      background: rgba(118, 235, 208, 0.07);
      font: 11px/1 var(--mono);
    }
    .vp-dashboard-title {
      margin: 0;
      color: #ffffff;
      font: 650 22px/1.1 var(--body);
      letter-spacing: -0.01em !important;
    }
    .vp-dashboard-subtitle {
      margin: 8px 0 0;
      color: #6b7585;
      font-size: 12px;
    }
    .vp-periods {
      display: flex;
      gap: 7px;
    }
    .vp-period.active {
      color: #76ebd0;
      border-color: rgba(118, 235, 208, 0.32);
      background: rgba(118, 235, 208, 0.10);
    }
    .vp-metric-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 24px;
    }
    .vp-metric {
      min-height: 82px;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
    }
    .vp-metric span {
      display: block;
      color: #6b7585;
      font: 9.5px/1 var(--mono);
      text-transform: uppercase;
    }
    .vp-metric strong {
      display: block;
      margin-top: 8px;
      color: #eaeff5;
      font: 650 22px/1 var(--mono);
    }
    .vp-metric small {
      display: block;
      margin-top: 6px;
      color: #6b7585;
      font-size: 10.5px;
    }
    .vp-metric.ok strong { color: #76ebd0; }
    .vp-metric.bad strong { color: #ff7a85; }
    .vp-metric.warn strong { color: #f4b860; }
    .vp-chart {
      height: 206px;
      position: relative;
      overflow: hidden;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background:
        linear-gradient(to bottom, transparent 0 24%, rgba(255, 255, 255, 0.08) 24.4% 24.8%, transparent 25% 49%, rgba(255, 255, 255, 0.08) 49.4% 49.8%, transparent 50% 74%, rgba(255, 255, 255, 0.08) 74.4% 74.8%, transparent 75%),
        linear-gradient(180deg, rgba(118, 235, 208, 0.045), transparent 52%);
    }
    .vp-chart::before,
    .vp-chart::after {
      content: "";
      position: absolute;
      left: 0;
      right: 39%;
      bottom: 18px;
      height: 54px;
      background-repeat: no-repeat;
      background-size: 100% 100%;
      filter: drop-shadow(0 0 9px rgba(118, 235, 208, 0.18));
    }
    .vp-chart::before {
      background-image: url("data:image/svg+xml,%3Csvg width='680' height='70' viewBox='0 0 680 70' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 55 L35 58 L70 53 L105 56 L140 54 L175 55 L210 57 L245 52 L280 56 L315 53 L350 55 L385 54 L420 51 L455 54 L490 52 L525 53 L560 51 L595 54 L630 52 L680 53' fill='none' stroke='%2376ebd0' stroke-width='2.6'/%3E%3C/svg%3E");
    }
    .vp-chart::after {
      bottom: 12px;
      opacity: 0.82;
      background-image: url("data:image/svg+xml,%3Csvg width='680' height='70' viewBox='0 0 680 70' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 59 L40 61 L80 58 L120 60 L160 59 L200 60 L240 58 L280 60 L320 59 L360 61 L400 58 L440 60 L480 59 L520 58 L560 59 L600 60 L640 59 L680 60' fill='none' stroke='%23f4b860' stroke-width='2'/%3E%3C/svg%3E");
    }
    .vp-chart-dot {
      position: absolute;
      right: 0;
      top: 11px;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #76ebd0;
      box-shadow: 0 0 0 5px rgba(118, 235, 208, 0.10);
    }
    .vp-chart-footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 16px 0 0;
      color: #6b7585;
      font-size: 11.5px;
    }
    .vp-legend {
      display: flex;
      gap: 14px;
      align-items: center;
    }
    .vp-legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .vp-legend i {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #76ebd0;
    }
    .vp-legend span:nth-child(2) i { background: #ff7a85; }
    .vp-legend span:nth-child(3) i { background: #f4b860; }
    .vp-logo-marquee {
      position: relative;
      z-index: 1;
      margin-top: 92px;
      padding: 66px 0;
      width: 100vw;
      margin-left: calc(50% - 50vw);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      overflow: hidden;
      background: rgba(6, 9, 14, 0.52);
    }
    .vp-logo-marquee p {
      margin: 0 0 28px;
      color: #6b7585;
      text-align: center;
      font: 10px/1 var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.28em !important;
    }
    .vp-logo-track {
      display: flex;
      gap: 56px;
      width: max-content;
      color: #8d96a5;
      font: 650 21px/1 var(--body);
      animation: vp-marquee 44s linear infinite;
    }
    .vp-logo-track span::before {
      content: "";
      display: inline-block;
      width: 5px;
      height: 5px;
      margin: 0 22px 4px 0;
      border-radius: 999px;
      background: #28313d;
    }
    .vp-stat-band {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      margin-top: 92px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 14px;
      overflow: hidden;
      background: rgba(12, 18, 24, 0.86);
      text-align: left;
    }
    .vp-stat-tile {
      min-height: 152px;
      padding: 32px;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
    }
    .vp-stat-tile:last-child { border-right: 0; }
    .vp-stat-tile strong {
      display: block;
      color: #76ebd0;
      font: 750 48px/1 var(--body);
      letter-spacing: -0.03em !important;
    }
    .vp-stat-tile:nth-child(3) strong { color: #f4b860; }
    .vp-stat-tile span {
      display: block;
      margin-top: 14px;
      color: #6b7585;
      font-size: 13px;
      line-height: 1.45;
    }
    @keyframes vp-marquee {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }
    @media (max-width: 980px) {
      .vp-preview-hero { padding-top: 92px; }
      .vp-nav-inner,
      .vp-preview-hero .vp-container {
        width: calc(100vw - 32px) !important;
        max-width: 760px;
      }
      .vp-brand {
        max-width: 190px;
        min-width: 0;
        gap: 9px;
      }
      .vp-brand-title { font-size: 14px; }
      .vp-brand-sub {
        margin-left: 5px;
        font-size: 9px;
      }
      .vp-hero-center .vp-hero-title { font-size: 48px !important; }
      .vp-actions { gap: 8px; }
      .vp-actions .vp-btn.secondary { display: none; }
      .vp-actions .vp-btn.primary {
        min-height: 38px;
        width: 110px;
        max-width: 110px;
        padding: 0 11px;
        white-space: normal;
        text-align: center;
        line-height: 1.1;
        font-size: 0;
      }
      .vp-actions .vp-btn.primary::before {
        content: "Book review →";
        font-size: 12px;
      }
      .vp-preview-hero .vp-cta-row {
        width: min(100%, 260px);
        flex-direction: column;
        margin-left: auto;
        margin-right: auto;
      }
      .vp-preview-hero .vp-cta-row .vp-btn {
        flex: none;
        width: 100%;
        padding: 0 12px;
        font-size: 13px;
        white-space: nowrap;
      }
      .vp-hero-copy,
      .vp-hero-points {
        max-width: calc(100vw - 32px);
      }
      .vp-dashboard-preview {
        width: 100%;
        max-width: 100%;
        margin-top: 52px;
        border-radius: 10px;
      }
      .vp-chrome-bar { grid-template-columns: auto 1fr; }
      .vp-url-chip {
        justify-self: end;
        max-width: min(100%, 205px);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .vp-live-chip { display: none; }
      .vp-dashboard-top { flex-direction: column; }
      .vp-periods { display: none; }
      .vp-metric-grid,
      .vp-stat-band { grid-template-columns: 1fr; }
      .vp-metric,
      .vp-stat-tile { border-right: 0; }
      .vp-logo-marquee { margin-top: 60px; padding: 48px 0; }
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
          <span class="vp-logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path fill="currentColor" d="M12 3.1 19 5.8v5.9c0 4.5-2.9 7.9-7 9.2-4.1-1.3-7-4.7-7-9.2V5.8l7-2.7Zm0 3.1-4.4 1.7v3.8c0 3 1.7 5.4 4.4 6.5 2.7-1.1 4.4-3.5 4.4-6.5V7.9L12 6.2Zm0 3.1a2.1 2.1 0 0 1 1.1 3.9v2.4h-2.2v-2.4A2.1 2.1 0 0 1 12 9.3Z" />
            </svg>
          </span>
          <span><span class="vp-brand-title">VaultProof</span><span class="vp-brand-sub">Enterprise</span></span>
        </a>
        <nav class="vp-links" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#threat">Threat model</a>
          <a href="#compliance">Compliance</a>
          <a href="/app/runbooks">Docs</a>
        </nav>
        <div class="vp-actions">
          <a class="vp-btn secondary" href="/app/dashboard">See it live</a>
          <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20security%20review">Book a security review →</a>
        </div>
      </div>
    </header>

    <main>
      <section class="vp-section vp-hero vp-preview-hero" id="product">
        <div class="vp-grid-bg" aria-hidden="true"></div>
        <div class="vp-container vp-hero-center">
          <h1 class="vp-hero-title">Runtime is the<br>attack surface <span class="vp-serif vp-mint">auditors</span><br><span class="vp-serif vp-gold">never</span> see.</h1>
          <p class="vp-hero-copy">VaultProof gives every API key in your stack a live shield, observed in production, attested per workload, and packaged into the audit evidence your CISO and security reviewers actually need.</p>
          <div class="vp-cta-row">
            <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20security%20review">Book a security review →</a>
            <a class="vp-btn secondary" href="/app/dashboard">▶ See it live</a>
          </div>
          <div class="vp-hero-points" aria-label="VaultProof rollout notes">
            <span><i></i>no agent install</span>
            <span><i></i>10 min to first signal</span>
            <span><i></i>evidence-ready by day 7</span>
          </div>

          <div class="vp-dashboard-preview" aria-label="VaultProof enterprise dashboard preview">
            <div class="vp-chrome-bar">
              <div class="vp-chrome-dots" aria-hidden="true"><i></i><i></i><i></i></div>
              <div class="vp-url-chip">enterprise.vaultproof.dev/dashboard</div>
              <div class="vp-live-chip"><span class="vp-dot"></span>live</div>
            </div>
            <div class="vp-dashboard-body">
              <div class="vp-dashboard-top">
                <div>
                  <div class="vp-dashboard-label"><span class="vp-dot"></span>Enterprise dashboard</div>
                  <h2 class="vp-dashboard-title">API key security overview</h2>
                  <p class="vp-dashboard-subtitle">Real-time posture across protected tokens and workloads.</p>
                </div>
                <div class="vp-periods" aria-label="Dashboard range selector">
                  <span class="vp-period">30d</span>
                  <span class="vp-period">90d</span>
                  <span class="vp-period active">6mo</span>
                </div>
              </div>
              <div class="vp-metric-grid">
                <div class="vp-metric"><span>Total calls</span><strong>1,197</strong><small>+12.4% vs prev</small></div>
                <div class="vp-metric ok"><span>Allowed</span><strong>1,102</strong><small>92.1% pass rate</small></div>
                <div class="vp-metric bad"><span>Blocked</span><strong>68</strong><small>5.7% of traffic</small></div>
                <div class="vp-metric warn"><span>Errors</span><strong>27</strong><small>2.3% upstream</small></div>
              </div>
              <div class="vp-chart" aria-hidden="true"><span class="vp-chart-dot"></span></div>
              <div class="vp-chart-footer">
                <div class="vp-legend"><span><i></i>Calls</span><span><i></i>Blocked</span><span><i></i>Errors</span></div>
                <span>peak 350 · 60 pts</span>
              </div>
            </div>
          </div>

          <div class="vp-logo-marquee" aria-label="Trusted by security teams shipping at scale">
            <p>Trusted by security teams shipping at scale</p>
            <div class="vp-logo-track" aria-hidden="true">
              <span>Linear</span><span>Cursor</span><span>Vercel</span><span>Anthropic</span><span>Notion</span><span>Ramp</span><span>Retool</span><span>Datadog</span>
              <span>Linear</span><span>Cursor</span><span>Vercel</span><span>Anthropic</span><span>Notion</span><span>Ramp</span><span>Retool</span><span>Datadog</span>
            </div>
          </div>

          <div class="vp-stat-band">
            <div class="vp-stat-tile"><strong>128M+</strong><span>API calls governed by project, provider, and source policy.</span></div>
            <div class="vp-stat-tile"><strong>99.98%</strong><span>target availability for enterprise proxy paths.</span></div>
            <div class="vp-stat-tile"><strong>38ms</strong><span>median policy decision overhead in the demo model.</span></div>
            <div class="vp-stat-tile"><strong>0</strong><span>raw provider keys required in application config after rollout.</span></div>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal" id="security">
        <div class="vp-container vp-two-col">
          <div>
            <div class="vp-eyebrow"><span>The operating model</span></div>
            <h2 class="vp-heading">Keep provider keys out of <em>applications, agents, and build systems.</em></h2>
            <p class="vp-copy">VaultProof sits between your workload and sensitive providers. The application sends an approved request, VaultProof enforces policy, the runtime uses the upstream key only for that call, and your team gets a clear record of what happened.</p>
            <div class="vp-steps">
              <b>01</b><span>Route approved provider calls through VaultProof</span>
              <b>02</b><span>Enforce project, provider, source, and budget policy</span>
              <b>03</b><span>Use upstream key material only inside the protected runtime</span>
              <b>04</b><span>Clear memory and write an audit event for review</span>
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

      <section class="vp-section vp-pad vp-reveal" id="threat">
        <div class="vp-container vp-threat-layout">
          <div class="vp-sticky">
            <div class="vp-eyebrow"><strong>02</strong><span>Why it matters</span></div>
            <h2 class="vp-heading">Leaked API keys become production incidents fast. <em>Reduce where raw secrets can exist.</em></h2>
          </div>
          <div>
            <article class="vp-threat-row"><div class="vp-threat-stat">sprawl</div><div><p>happens when provider keys sit across app configs, CI variables, local developer machines, SaaS settings, and support tooling.</p><div class="vp-source">Operational risk</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat">agents</div><div><p>increase the number of systems that can trigger provider calls, making source controls and scoped runtime access more important.</p><div class="vp-source">AI rollout risk</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat">minutes</div><div><p>can be enough time for a leaked key in GitHub, logs, a laptop, or a build system to become expensive abuse.</p><div class="vp-source">Common incident pattern</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="0">0</div><div><p>raw keys should live in application runtime once the workload is routed through VaultProof.</p><div class="vp-source">VaultProof operating model</div></div></article>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-two-col" style="align-items:end;margin-bottom:44px">
            <div>
              <div class="vp-eyebrow"><strong>03</strong><span>Request path</span></div>
              <h2 class="vp-heading"><em>Route.</em> Authorize. Execute. Record.</h2>
            </div>
            <p class="vp-copy" style="margin:0">Your application keeps its existing provider logic while sensitive calls are routed through VaultProof for policy checks, protected key use, and audit capture.</p>
          </div>
          <div class="vp-region-strip">
            <span><i></i>1/5 · us-east-1</span><span><i></i>2/5 · eu-west-2</span><span><i></i>3/5 · ap-south-1</span><span><i></i>4/5 · us-west-2</span><span><i></i>5/5 · eu-north-1</span>
          </div>
          <div class="vp-mechanism-grid">
            <div class="vp-wire"></div><div class="vp-beam"></div>
            <article class="vp-node"><div class="vp-node-dot">01</div><div><h3>Workload</h3><p>The app, agent, or automation calls VaultProof instead of carrying a raw upstream key.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">02</div><div><h3>Policy runtime</h3><p>VaultProof checks organization, project, provider, source, and budget rules before execution.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">03</div><div><h3>Provider</h3><p>The approved request reaches OpenAI, Stripe, Twilio, Snowflake, Datadog, or another provider.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">04</div><div><h3>Evidence</h3><p>The key is cleared from memory and the security team gets an audit event it can review.</p></div></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal" id="integrations">
        <div class="vp-container vp-code-layout">
          <div>
            <div class="vp-eyebrow"><strong>04</strong><span>Rollout</span></div>
            <h2 class="vp-heading">Keep the provider workflow. <em>Move the raw key out.</em></h2>
            <p class="vp-copy">Start with the highest-risk provider key and route that workload through VaultProof. Existing SDKs, model providers, payment APIs, messaging tools, and data platforms can keep their familiar request patterns.</p>
            <div class="vp-checklist">
              <span>Start with one critical provider or agent workflow</span>
              <span>Keep provider-compatible SDKs, URLs, and app logic where possible</span>
              <span>Use Cloud KMS or customer-managed gateway patterns for stronger custody controls</span>
              <span>Export request evidence to security and compliance review workflows</span>
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
              <span>vault-id found · policy approved · runtime used key · memory cleared</span>
              <span class="vp-code-sign"><span class="vp-dot"></span>signed audit event #<span id="audit-id">84,127,902</span></span>
            </div>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-features-head">
            <div>
              <div class="vp-eyebrow"><strong>05</strong><span>Controls</span></div>
              <h2 class="vp-heading" style="font-size:48px">Enterprise controls for critical API usage.</h2>
            </div>
            <a href="mailto:security@vaultproof.dev?subject=VaultProof%20architecture%20brief" style="color:var(--accent);font-weight:500;font-size:13px">Architecture brief →</a>
          </div>
          <div class="vp-feature-grid">
            <article class="vp-card"><div class="vp-card-num">01 / 06</div><h3>No raw keys in apps</h3><p>Move provider secrets out of code, env vars, CI logs, app databases, agent prompts, and support tooling.</p></article>
            <article class="vp-card"><div class="vp-card-num">02 / 06</div><h3>Policy-gated proxy</h3><p>Approve usage by organization, project, provider, source, budget, and customer gateway pattern.</p></article>
            <article class="vp-card"><div class="vp-card-num">03 / 06</div><h3>Protected runtime use</h3><p>Use upstream key material only inside the controlled execution path required for an approved request.</p></article>
            <article class="vp-card"><div class="vp-card-num">04 / 06</div><h3>Audit-ready records</h3><p>Capture request metadata that helps security teams review access without exposing raw provider secrets.</p></article>
            <article class="vp-card"><div class="vp-card-num">05 / 06</div><h3>Customer custody paths</h3><p>Use Cloud KMS or customer-managed gateway patterns when ownership and shutdown controls matter.</p></article>
            <article class="vp-card"><div class="vp-card-num">06 / 06</div><h3>Provider-compatible rollout</h3><p>Protect calls to OpenAI, Stripe, Twilio, Snowflake, Datadog, internal APIs, and other sensitive providers.</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-grid-bg" aria-hidden="true"></div>
        <div class="vp-container" style="position:relative">
          <div class="vp-eyebrow"><strong>06</strong><span>Security review</span></div>
          <h2 class="vp-heading" style="max-width:15ch;font-size:64px;margin-bottom:48px">Designed for <em>security review.</em></h2>
          <div class="vp-belief-grid">
            <article class="vp-belief"><div class="vp-card-num">01</div><h3>Reduce key sprawl.</h3><p>Fewer places hold raw provider secrets, so security teams have a smaller surface to monitor and defend.</p></article>
            <article class="vp-belief"><div class="vp-card-num">02</div><h3>Authorize every critical call.</h3><p>VaultProof evaluates policy at the moment of use instead of trusting a secret that can be copied elsewhere.</p></article>
            <article class="vp-belief"><div class="vp-card-num">03</div><h3>Produce readable evidence.</h3><p>Every approved or denied call can leave an audit record your team can inspect during review or incident response.</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal" id="compliance">
        <div class="vp-container">
          <div class="vp-two-col" style="align-items:baseline;margin-bottom:32px">
            <div>
              <div class="vp-eyebrow"><strong>07</strong><span>Trust program</span></div>
              <h2 class="vp-heading">Evidence for the review process. <em>No vague security theater.</em></h2>
            </div>
            <p class="vp-copy" style="margin:0">VaultProof makes formal compliance claims only when the evidence is ready. Enterprise pilots receive architecture notes, readiness checks, health views, audit exports, and clear boundaries for what VaultProof can and cannot prove.</p>
          </div>
          <div class="vp-compliance-grid">
            <article class="vp-compliance-card"><h3>SOC 2 Type II</h3><p>Roadmap · evidence program in progress</p></article>
            <article class="vp-compliance-card"><h3>ISO 27001</h3><p>Control mapping and audit planning</p></article>
            <article class="vp-compliance-card"><h3>HIPAA</h3><p>Architecture review and BAA path available</p></article>
            <article class="vp-compliance-card"><h3>GDPR</h3><p>EU data residency available · DPA on request</p></article>
            <article class="vp-compliance-card"><h3>PCI DSS</h3><p>Scoped review for payment-adjacent workflows</p></article>
            <article class="vp-compliance-card"><h3>FedRAMP</h3><p>Roadmap item for later public-sector work</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal" id="cta">
        <div class="vp-container">
          <div class="vp-final">
            <div class="vp-eyebrow" style="justify-content:center"><span>Enterprise walkthrough</span></div>
            <h2>Protect the API keys <em>your business cannot afford to leak.</em></h2>
            <p>Bring one critical provider workflow. We will map the rollout, custody model, policy controls, and audit evidence your security team needs before production traffic moves behind VaultProof.</p>
            <div class="vp-cta-row" style="justify-content:center;margin-top:40px">
              <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20Enterprise%20walkthrough">Talk to enterprise sales</a>
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
            <div class="vp-brand" style="min-width:0"><span class="vp-brand-title">VaultProof</span></div>
            <p>Runtime API key protection for enterprise teams that need provider access without raw secrets spread across apps, agents, logs, and build systems.</p>
          </div>
          <div><h3>Platform</h3><ul><li>Policy-gated proxy</li><li>Protected runtime use</li><li>Access rules</li><li>Audit records</li><li>Cloud KMS custody</li></ul></div>
          <div><h3>Resources</h3><ul><li><a href="/readiness">Readiness</a></li><li><a href="/health">Health</a></li><li><a href="/app/dashboard">Dashboard</a></li><li><a href="/app/alerts">Alerts</a></li></ul></div>
          <div><h3>Company</h3><ul><li>Enterprise pilots</li><li>Design partners</li><li>Security review</li><li>Launch support</li></ul></div>
          <div><h3>Contact</h3><ul><li><a href="mailto:hello@vaultproof.dev">hello@vaultproof.dev</a></li><li><a href="mailto:security@vaultproof.dev">security@vaultproof.dev</a></li><li>San Francisco, CA</li></ul></div>
        </div>
        <div class="vp-footer-bottom"><span>© 2026 VaultProof, Inc.</span><span>ENTERPRISE · <span style="color:var(--success)">PILOT READY</span></span><span>Privacy · Terms · Security</span></div>
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
        { lib: 'DeepL', pkg: 'deepl-node', envVar: 'DEEPL_AUTH_KEY', vp: 'vp://deepl-prod', ctor: 'new DeepL.Translator', call: 'translateText' },
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
