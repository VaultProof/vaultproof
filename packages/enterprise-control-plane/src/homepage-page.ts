import type { EnterpriseControlPlaneEnv } from './config.js';
import { injectEnterpriseAnalytics } from './analytics.js';

export function renderEnterpriseHomepage(env: EnterpriseControlPlaneEnv = {}): string {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VaultProof - Secrets, never whole at rest</title>
  <meta name="description" content="VaultProof is an enterprise security layer for API keys and secrets. Split keys across regions, reassemble them only inside an attested proxy, and never store raw secrets whole at rest." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      color-scheme: light;
      --bg: #f2eee5;
      --paper: #fbf9f4;
      --surface: #e8e2d4;
      --ink: #14120e;
      --ink-soft: #3d3a33;
      --muted: #867f6f;
      --line: rgba(20, 18, 14, 0.12);
      --line-strong: rgba(20, 18, 14, 0.25);
      --line-soft: rgba(20, 18, 14, 0.06);
      --accent: #8b5a3c;
      --accent-soft: rgba(139, 90, 60, 0.12);
      --success: #3f6b47;
      --danger: #b44838;
      --display: "Newsreader", "Times New Roman", Georgia, serif;
      --body: "Inter Tight", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--body);
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
      background: rgba(242, 238, 229, 0.88);
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
    .vp-btn.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .vp-btn.secondary { background: transparent; color: var(--ink); }
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
      background-image: radial-gradient(rgba(20, 18, 14, 0.1) 1px, transparent 1px);
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
      background: var(--paper);
      border: 0.5px solid var(--line);
      border-radius: 9px;
      padding: 5px 18px;
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 18px 60px -20px rgba(20,18,14,.18);
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
      background: var(--paper);
      border: 0.5px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 18px 60px -20px rgba(20,18,14,.18);
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
      border: 6px solid var(--ink);
      border-right: 0;
      border-radius: 18px 0 0 18px;
      position: relative;
    }
    .vp-key-glyph::before {
      content: "";
      position: absolute;
      left: 33px;
      top: 2px;
      width: 42px;
      height: 6px;
      background: var(--ink);
    }
    .vp-key-glyph::after {
      content: "";
      position: absolute;
      left: 60px;
      top: 2px;
      width: 4px;
      height: 15px;
      background: var(--ink);
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
      box-shadow: 0 0 0 0 rgba(139, 90, 60, .35);
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
      background: var(--paper);
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
      background: var(--paper);
      border: 0.5px solid var(--line);
      border-radius: 9px;
      overflow: hidden;
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 18px 60px -20px rgba(20,18,14,.18);
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
    .vp-code-remove { background: rgba(192, 57, 43, .14); color: var(--muted); }
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
    .vp-reveal { opacity: 0; transform: translateY(18px); transition: opacity 850ms cubic-bezier(.2,.6,.2,1), transform 850ms cubic-bezier(.2,.6,.2,1); }
    .vp-reveal.visible { opacity: 1; transform: translateY(0); }
    @keyframes vp-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
    @keyframes vp-feed-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes vp-key-core { 0%, 5%, 95%, 100% { opacity: 1; } 15%, 90% { opacity: .18; } }
    @keyframes vp-region-pulse { 0%, 40% { box-shadow: 0 0 0 0 rgba(139,90,60,.28); } 52% { box-shadow: 0 0 0 12px rgba(139,90,60,.13); } 70%, 100% { box-shadow: 0 0 0 18px transparent; } }
    @keyframes vp-shard {
      0%, 5% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
      35%, 65% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot)); opacity: 1; }
      95%, 100% { transform: translate(-50%, -50%) rotate(0deg); opacity: 1; }
    }
    @keyframes vp-node-pulse { 0%, 50% { box-shadow: 0 0 0 0 rgba(139,90,60,.28); } 58% { box-shadow: 0 0 0 8px rgba(139,90,60,.18); } 74%, 100% { box-shadow: 0 0 0 16px transparent; } }
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
          <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20Enterprise%20demo">Book a demo →</a>
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
          <div class="vp-eyebrow"><strong>§ 01</strong><span>The plaintext problem</span></div>
          <h1 class="vp-hero-title">Your secrets,<br><em>never whole at rest.</em></h1>
          <div class="vp-hero-lower">
            <div>
              <p class="vp-lede">VaultProof shards every API key across independent regions and reassembles it for milliseconds inside an attested proxy. The plaintext that cannot leak is the one that does not exist.</p>
              <div class="vp-cta-row">
                <a class="vp-btn primary" href="mailto:security@vaultproof.dev?subject=VaultProof%20Enterprise%20early%20access">Request early access →</a>
                <a class="vp-btn secondary" href="/app/login">Enterprise sign in</a>
              </div>
              <div class="vp-proof-stat">
                <div class="vp-stat-big" data-count="99.998" data-suffix="%">0%</div>
                <p class="vp-stat-caption">Illustrative reassembly success across 1.42 million proxied calls in a 30-day production-style run.</p>
              </div>
            </div>
            <div>
              <div class="vp-feed-head"><span>Illustrative · simulated proxy feed</span><span class="vp-live"><span class="vp-dot"></span>streaming</span></div>
              <div class="vp-feed-card" id="proxy-feed" aria-live="polite"></div>
              <p class="vp-note">An animated example of the proxy in action. Not real customer traffic; the live production posture remains available at <a href="/readiness">/readiness</a>.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal" id="security">
        <div class="vp-container vp-two-col">
          <div>
            <div class="vp-eyebrow"><span>Architecture · at a glance</span></div>
            <h2 class="vp-heading">One key, <em>five regions,</em> zero plaintext at rest.</h2>
            <p class="vp-copy">Every secret is split into five cryptographic shards using Shamir's Secret Sharing, then sealed into different KMS regions. Three are needed to reassemble; no single region or operator ever holds the whole.</p>
            <div class="vp-steps">
              <b>01</b><span>Split at write time, never reversed on disk</span>
              <b>02</b><span>Distribute into independent KMS regions</span>
              <b>03</b><span>Reassemble only inside an attested runtime</span>
              <b>04</b><span>Wipe memory and write signed audit evidence</span>
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
            <div class="vp-eyebrow"><strong>§ 02</strong><span>The case</span></div>
            <h2 class="vp-heading">Every secret in your fleet is one <em>misconfigured env-var</em> from disclosure.</h2>
          </div>
          <div>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="80" data-prefix="~" data-suffix="%">~0%</div><div><p>of breaches involve a stolen or misused credential in industry reports like Verizon's DBIR.</p><div class="vp-source">— Verizon DBIR, recent years</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="4.88" data-prefix="$" data-suffix="M">$0M</div><div><p>average global cost of a single data breach, per IBM's annual study, with credential-driven incidents skewing higher and longer to contain.</p><div class="vp-source">— IBM Cost of a Data Breach Report</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat">months</div><div><p>is the typical dwell time between credential compromise and detection in many post-incident reports. The window is rarely measured in hours.</p><div class="vp-source">— Public incident post-mortems</div></div></article>
            <article class="vp-threat-row"><div class="vp-threat-stat" data-count="1">0</div><div><p>plaintext copy is one too many. The only key that cannot leak is the one that does not exist whole.</p><div class="vp-source">— Our thesis</div></div></article>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-two-col" style="align-items:end;margin-bottom:44px">
            <div>
              <div class="vp-eyebrow"><strong>§ 03</strong><span>The mechanism</span></div>
              <h2 class="vp-heading"><em>Split.</em> Encrypt. Reassemble for milliseconds.</h2>
            </div>
            <p class="vp-copy" style="margin:0">Shamir threshold sharing splits each secret into five fragments, sealed into independent KMS regions. Reassembly happens only inside an attested runtime, only for the duration of a single proxied call.</p>
          </div>
          <div class="vp-region-strip">
            <span><i></i>1/5 · us-east-1</span><span><i></i>2/5 · eu-west-2</span><span><i></i>3/5 · ap-south-1</span><span><i></i>4/5 · us-west-2</span><span><i></i>5/5 · eu-north-1</span>
          </div>
          <div class="vp-mechanism-grid">
            <div class="vp-wire"></div><div class="vp-beam"></div>
            <article class="vp-node"><div class="vp-node-dot">01</div><div><h3>Receive</h3><p>Your service hits one VaultProof endpoint instead of the upstream API.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">02</div><div><h3>Reassemble</h3><p>Three of five shares are pulled from independent regions into an attested enclave.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">03</div><div><h3>Proxy</h3><p>The whole key exists for about 11ms inside the enclave to sign one outbound call.</p></div></article>
            <article class="vp-node"><div class="vp-node-dot">04</div><div><h3>Zero</h3><p>Memory is wiped. A signed, hash-chained event lands in your SIEM.</p></div></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal" id="integrations">
        <div class="vp-container vp-code-layout">
          <div>
            <div class="vp-eyebrow"><strong>§ 04</strong><span>Integration</span></div>
            <h2 class="vp-heading">One line. <em>That's the migration.</em></h2>
            <p class="vp-copy">Swap your upstream secret reference for a VaultProof vault URI. Your dependencies, SDK calls, and business logic stay familiar while secrets are pulled from the vault and reassembled per request inside the proxy.</p>
            <div class="vp-checklist">
              <span>No SDK rewrite for common HTTP clients</span>
              <span>Native libraries planned for TypeScript, Python, Go, Rust, and the JVM</span>
              <span>Bring-your-own-key path for Azure Managed HSM, AWS KMS, GCP KMS, and on-prem HSM</span>
              <span>Optional Kubernetes operator and HashiCorp Vault sync</span>
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
              <span>vault-id resolved · 3/5 shares assembled · enclave attested</span>
              <span class="vp-code-sign"><span class="vp-dot"></span>signed audit event #<span id="audit-id">84,127,902</span></span>
            </div>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-container">
          <div class="vp-features-head">
            <div>
              <div class="vp-eyebrow"><strong>§ 05</strong><span>Capabilities</span></div>
              <h2 class="vp-heading" style="font-size:48px">Six guarantees, end to end.</h2>
            </div>
            <a href="mailto:security@vaultproof.dev?subject=VaultProof%20architecture%20brief" style="color:var(--accent);font-weight:500;font-size:13px">Architecture brief →</a>
          </div>
          <div class="vp-feature-grid">
            <article class="vp-card"><div class="vp-card-num">01 / 06</div><h3>Threshold-split secrets</h3><p>Shamir 3-of-5 by default. HSM-backed shares. Per-vault tunable thresholds.</p></article>
            <article class="vp-card"><div class="vp-card-num">02 / 06</div><h3>Attested runtime</h3><p>Reassembly inside an Azure Confidential VM path with attestation evidence on the production route.</p></article>
            <article class="vp-card"><div class="vp-card-num">03 / 06</div><h3>Policy-bound proxy</h3><p>Per-project origin, method, host, provider, customer gateway, and client-class controls.</p></article>
            <article class="vp-card"><div class="vp-card-num">04 / 06</div><h3>Tamper-evident audit</h3><p>Signed enterprise events, access review exports, alert dispatch logs, and SIEM-ready evidence.</p></article>
            <article class="vp-card"><div class="vp-card-num">05 / 06</div><h3>BYO Azure key path</h3><p>Support customer-owned Key Vault or Managed HSM release policies so customers keep key ownership and revocation power.</p></article>
            <article class="vp-card"><div class="vp-card-num">06 / 06</div><h3>Drop-in provider slots</h3><p>OpenAI, Stripe, Twilio, Snowflake, Datadog, and other API providers behind the same enterprise control plane.</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section vp-pad vp-reveal">
        <div class="vp-grid-bg" aria-hidden="true"></div>
        <div class="vp-container" style="position:relative">
          <div class="vp-eyebrow"><strong>§ 06</strong><span>The point of view</span></div>
          <h2 class="vp-heading" style="max-width:14ch;font-size:clamp(48px,5.6vw,88px);margin-bottom:64px">What we <em>believe.</em></h2>
          <div class="vp-belief-grid">
            <article class="vp-belief"><div class="vp-card-num">01</div><h3>A whole secret is a liability.</h3><p>The credential itself should not exist whole anywhere except for the milliseconds it is signing your call.</p></article>
            <article class="vp-belief"><div class="vp-card-num">02</div><h3>Trust is not an org chart. It is a math problem.</h3><p>Threshold cryptography splits trust across parties, regions, and operators so no single human can compromise a managed key.</p></article>
            <article class="vp-belief"><div class="vp-card-num">03</div><h3>Audit logs should be a load-bearing wall.</h3><p>Every reassembly should be a discrete signed event you can replay independently without trusting our word for it.</p></article>
          </div>
        </div>
      </section>

      <section class="vp-section surface vp-pad vp-reveal" id="trust">
        <div class="vp-container">
          <div class="vp-two-col" style="align-items:baseline;margin-bottom:32px">
            <div>
              <div class="vp-eyebrow"><strong>§ 07</strong><span>Trust · the honest version</span></div>
              <h2 class="vp-heading">We're early. <em>Here's exactly where we are.</em></h2>
            </div>
            <p class="vp-copy" style="margin:0">VaultProof is in private beta. We will not pretend to have certifications before auditors sign them. What we do have is a production-confidential Azure path, a clear architecture, and a published route to the compliance artifacts enterprise buyers need.</p>
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
            <h2>Bring us the secret <em>you fear most.</em></h2>
            <p>We're working with a small number of design partners while we harden the platform. If you have a credential that keeps your security team awake, we'd like to hear about it.</p>
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
            <p>Threshold-split secret management for enterprise API keys. Private beta, building in the open with design partners.</p>
          </div>
          <div><h3>Platform</h3><ul><li>Threshold splitting</li><li>Attested proxy</li><li>Policy engine</li><li>Audit & SIEM</li><li>BYO Azure keys</li></ul></div>
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
