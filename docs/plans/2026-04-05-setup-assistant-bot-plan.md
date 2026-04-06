# Setup Assistant Bot — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a floating chat widget to vaultproof.dev that guides users through setup and provides ongoing VaultProof-specific help, powered by Minimax + Hindsight memory.

**Architecture:** CF Worker route (`/api/v1/chat/message`) handles chat requests — calls Hindsight REST API for memory recall, builds a system prompt with VaultProof docs, calls Minimax for the LLM response, then retains the exchange in Hindsight. A vanilla JS widget on every page provides the UI.

**Tech Stack:** Cloudflare Worker (TypeScript), Minimax API, Hindsight (Docker on Railway), Supabase PostgreSQL, vanilla JS widget.

**Design doc:** `docs/plans/2026-04-05-setup-assistant-bot-design.md`

---

### Task 1: Add Env Vars for Chat to Worker

**Files:**
- Modify: `packages/worker/src/types.ts:1-12`
- Modify: `packages/worker/wrangler.toml`

**Step 1: Add env vars to Env interface**

In `packages/worker/src/types.ts`, add three new fields to the `Env` interface:

```typescript
export interface Env {
  ALLOWED_ORIGINS: string;
  VAULT_ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_EMAILS: string;
  STRIPE_SECRET_KEY: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_REDIRECT_URI: string;
  CACHE: KVNamespace;
  // Chat assistant
  MINIMAX_API_KEY: string;
  HINDSIGHT_URL: string;
}
```

**Step 2: Add placeholder vars to wrangler.toml**

In `packages/worker/wrangler.toml`, add under `[vars]`:

```toml
HINDSIGHT_URL = "https://hindsight.vaultproof.dev"
```

Note: `MINIMAX_API_KEY` is a secret — set via `wrangler secret put MINIMAX_API_KEY`.

**Step 3: Commit**

```bash
git add packages/worker/src/types.ts packages/worker/wrangler.toml
git commit -m "feat(chat): add MINIMAX_API_KEY and HINDSIGHT_URL env vars"
```

---

### Task 2: Create Chat Rate Limiter

**Files:**
- Modify: `packages/worker/src/lib/rate-limit.ts`

**Step 1: Add chat rate limit function**

Add this function at the end of `packages/worker/src/lib/rate-limit.ts`. It follows the same pattern as `checkPublicIpRateLimit` but with chat-specific limits (10/min, 50/hr):

```typescript
const CHAT_RPM = 10;
const CHAT_RPH = 50;

export async function checkChatRateLimit(
  env: Env,
  ip: string,
): Promise<{ allowed: boolean }> {
  const now = Date.now();
  const minuteKey = `chat:${ip}:m:${Math.floor(now / 60_000)}`;
  const hourKey = `chat:${ip}:h:${Math.floor(now / 3_600_000)}`;

  // Check minute limit via KV
  const minuteCount = parseInt((await env.CACHE.get(minuteKey)) || '0');
  if (minuteCount >= CHAT_RPM) return { allowed: false };

  // Check hour limit via KV
  const hourCount = parseInt((await env.CACHE.get(hourKey)) || '0');
  if (hourCount >= CHAT_RPH) return { allowed: false };

  // Increment both counters
  await Promise.all([
    env.CACHE.put(minuteKey, String(minuteCount + 1), { expirationTtl: 60 }),
    env.CACHE.put(hourKey, String(hourCount + 1), { expirationTtl: 3600 }),
  ]);

  return { allowed: true };
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/rate-limit.ts
git commit -m "feat(chat): add chat-specific rate limiter (10/min, 50/hr)"
```

---

### Task 3: Create System Prompt

**Files:**
- Create: `packages/worker/src/lib/chat-prompt.ts`

**Step 1: Create the system prompt module**

This contains the VaultProof knowledge base and bot persona. The prompt is hardcoded (not fetched from docs at runtime) for speed and reliability.

```typescript
export const SYSTEM_PROMPT = `You are the VaultProof Setup Assistant. You help users set up and use VaultProof — a zero-knowledge API key vault.

## Your Rules
- ONLY answer questions about VaultProof. For anything else, say: "I can only help with VaultProof — check our docs at vaultproof.dev/docs for more info."
- Be concise, technical, and helpful. No jargon.
- When guiding setup, ask what provider they're using (OpenAI, Anthropic, etc.) and walk them through step by step.
- Never mention internal implementation details like Shamir, GF(256), or Noir circuits.

## What VaultProof Does
VaultProof securely stores API keys using split-key encryption. Your key is split the moment you enter it — no one (including VaultProof) ever sees the full key. When your app makes an API call, VaultProof reconstructs the key for that single request, then immediately destroys it.

## Setup Guide

### Quick Start (Transparent Proxy)
1. Store your API key at vaultproof.dev/app/keys
2. Copy your access token (starts with vp_live_)
3. Change your base URL to: https://api.vaultproof.dev/v1/{provider}
   - OpenAI: https://api.vaultproof.dev/v1/openai
   - Anthropic: https://api.vaultproof.dev/v1/anthropic
4. Use your vp_live_ token as the API key
5. That's it — your existing code works unchanged

### SDK Integration
1. Install: npm install @vaultproof/sdk
2. Import and configure:
   \`\`\`javascript
   import { VaultProof } from '@vaultproof/sdk';
   const vp = new VaultProof({ token: 'vp_live_...' });
   \`\`\`

### CLI Usage
1. Install: npm install -g @vaultproof/cli
2. Login: vaultproof login
3. Run with injected keys: vaultproof exec -- npm start

### Agent Keys
For AI agents that need scoped, time-limited access:
1. Go to vaultproof.dev/app/agents
2. Create an agent key with TTL and spend cap
3. Use the vp_agent_ token in your agent's config

### Widget (For App Developers)
Embed the VaultProof widget so your users can store their own keys:
1. Install: npm install @vaultproof/widget
2. Add the React component to your app
3. Widget handles key splitting — you get a token back

## Plans
- Free: 3 key slots, 1,000 API calls/month, community support
- Starter ($9/mo): 10 key slots, 10,000 calls/month, email support
- Pro ($29/mo): 50 key slots, 100,000 calls/month, priority support, agent keys

## Common Issues
- "Invalid token": Make sure you're using the vp_live_ or vp_agent_ token, not your original API key
- "Rate limited": Check your plan limits at vaultproof.dev/app/plans
- "Provider not supported": Check supported providers at vaultproof.dev/docs
- CORS errors: Make sure your domain is added in Settings > Allowed Origins
`;
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/chat-prompt.ts
git commit -m "feat(chat): add system prompt with VaultProof knowledge base"
```

---

### Task 4: Create Chat Route Handler

**Files:**
- Create: `packages/worker/src/routes/chat.ts`

**Step 1: Create the chat route**

This is the core handler. It validates input, recalls Hindsight memory, calls Minimax, and retains the exchange. Returns a streamed response.

```typescript
import type { Env } from '../types.js';
import { checkChatRateLimit } from '../lib/rate-limit.js';
import { SYSTEM_PROMPT } from '../lib/chat-prompt.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 500;

interface ChatRequest {
  session_id: string;
  message: string;
}

async function recallMemory(env: Env, sessionId: string, query: string): Promise<string> {
  try {
    const res = await fetch(`${env.HINDSIGHT_URL}/v1/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank_id: sessionId, query }),
    });
    if (!res.ok) return '';
    const data = await res.json() as { memories?: string[] };
    return (data.memories || []).join('\n');
  } catch {
    return '';
  }
}

async function retainMemory(env: Env, sessionId: string, content: string): Promise<void> {
  try {
    await fetch(`${env.HINDSIGHT_URL}/v1/retain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank_id: sessionId, content }),
    });
  } catch {
    // Fire-and-forget — don't block the response
  }
}

export async function handleChat(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (path !== 'message' || request.method !== 'POST') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Rate limit by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkChatRateLimit(env, ip);
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many messages — please wait a moment.' },
      { status: 429 },
    );
  }

  // Parse and validate
  let body: ChatRequest;
  try {
    body = await request.json() as ChatRequest;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.session_id || !UUID_RE.test(body.session_id)) {
    return Response.json({ error: 'Invalid session_id (must be UUID)' }, { status: 400 });
  }
  if (!body.message || typeof body.message !== 'string') {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` }, { status: 400 });
  }

  // Recall prior context from Hindsight
  const memories = await recallMemory(env, body.session_id, body.message);

  // Build messages for Minimax
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];
  if (memories) {
    messages.push({
      role: 'system',
      content: `Previous context about this user:\n${memories}`,
    });
  }
  messages.push({ role: 'user', content: body.message });

  // Call Minimax API
  const minimaxRes = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      messages,
      stream: false,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!minimaxRes.ok) {
    return Response.json(
      { error: 'Assistant is temporarily unavailable. Please try again.' },
      { status: 502 },
    );
  }

  const minimaxData = await minimaxRes.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = minimaxData.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

  // Retain the exchange in Hindsight (fire-and-forget)
  retainMemory(env, body.session_id, `User: ${body.message}\nAssistant: ${reply}`);

  return Response.json({ reply });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/chat.ts
git commit -m "feat(chat): add chat route handler with Minimax + Hindsight"
```

---

### Task 5: Wire Chat Route into Worker

**Files:**
- Modify: `packages/worker/src/index.ts`

**Step 1: Add import**

Add after the existing imports (line 13):

```typescript
import { handleChat } from './routes/chat.js';
```

**Step 2: Add route dispatch**

Add this block before the `// Admin routes` section (before line 157). It follows the exact same pattern as existing routes but uses `checkChatRateLimit` inline in the handler rather than here:

```typescript
    // Chat routes (public, rate limited in handler)
    if (url.pathname.startsWith('/api/v1/chat/')) {
      try {
        const path = url.pathname.slice('/api/v1/chat/'.length);
        const response = await handleChat(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }
```

**Step 3: Commit**

```bash
git add packages/worker/src/index.ts
git commit -m "feat(chat): wire /api/v1/chat/ route into worker"
```

---

### Task 6: Create Chat Widget JS

**Files:**
- Create: `apps/site/js/chat-widget.js`

**Step 1: Create the widget**

This is a self-contained vanilla JS file that creates the floating chat bubble and chat panel. It matches the existing VaultProof dark design language.

```javascript
(function () {
  'use strict';

  var API_URL = 'https://api.vaultproof.dev/api/v1/chat/message';
  var SESSION_KEY = 'vp_chat_sid';
  var STATE_KEY = 'vp_chat_open';
  var HISTORY_KEY = 'vp_chat_history';

  function getSessionId() {
    var sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  }

  function saveHistory(messages) {
    try {
      // Keep last 50 messages to avoid localStorage bloat
      var trimmed = messages.slice(-50);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch { /* ignore */ }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createWidget() {
    // Styles
    var style = document.createElement('style');
    style.textContent = [
      '#vp-chat-bubble{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#6366f1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(99,102,241,0.4);z-index:99999;transition:transform .2s,box-shadow .2s}',
      '#vp-chat-bubble:hover{transform:scale(1.08);box-shadow:0 4px 28px rgba(99,102,241,0.6)}',
      '#vp-chat-bubble svg{width:28px;height:28px;fill:#fff}',
      '#vp-chat-panel{position:fixed;bottom:92px;right:24px;width:380px;height:500px;background:rgba(17,17,24,0.95);backdrop-filter:blur(12px);border:1px solid #1e1e2e;border-radius:14px;z-index:99999;display:none;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.5);font-family:Inter,sans-serif}',
      '#vp-chat-panel.open{display:flex}',
      '#vp-chat-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid #1e1e2e}',
      '#vp-chat-header span{color:#e2e8f0;font-size:14px;font-weight:600}',
      '#vp-chat-close{background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:4px 8px}',
      '#vp-chat-close:hover{color:#e2e8f0}',
      '#vp-chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}',
      '#vp-chat-messages::-webkit-scrollbar{width:4px}',
      '#vp-chat-messages::-webkit-scrollbar-thumb{background:#1e1e2e;border-radius:2px}',
      '.vp-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;color:#e2e8f0;word-wrap:break-word;white-space:pre-wrap}',
      '.vp-msg.bot{background:#1a1a2e;align-self:flex-start;border:1px solid #1e1e2e}',
      '.vp-msg.user{background:#6366f1;align-self:flex-end;color:#fff}',
      '.vp-msg code{font-family:"JetBrains Mono",monospace;font-size:12px;background:rgba(0,0,0,0.3);padding:1px 4px;border-radius:4px}',
      '#vp-chat-form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #1e1e2e}',
      '#vp-chat-input{flex:1;background:#0d0d14;border:1px solid #1e1e2e;border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:13px;font-family:Inter,sans-serif;outline:none;resize:none}',
      '#vp-chat-input:focus{border-color:#6366f1}',
      '#vp-chat-input::placeholder{color:#475569}',
      '#vp-chat-send{background:#6366f1;border:none;border-radius:8px;padding:10px 16px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;transition:background .15s}',
      '#vp-chat-send:hover{background:#4f46e5}',
      '#vp-chat-send:disabled{opacity:0.5;cursor:not-allowed}',
      '@media(max-width:480px){#vp-chat-panel{width:calc(100vw - 32px);right:16px;bottom:84px;height:60vh}}',
    ].join('\n');
    document.head.appendChild(style);

    // Bubble
    var bubble = document.createElement('div');
    bubble.id = 'vp-chat-bubble';
    bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
    document.body.appendChild(bubble);

    // Panel
    var panel = document.createElement('div');
    panel.id = 'vp-chat-panel';
    panel.innerHTML = [
      '<div id="vp-chat-header"><span>VaultProof Assistant</span><button id="vp-chat-close">&times;</button></div>',
      '<div id="vp-chat-messages"></div>',
      '<form id="vp-chat-form"><input id="vp-chat-input" placeholder="Ask about VaultProof..." maxlength="500" autocomplete="off"><button id="vp-chat-send" type="submit">Send</button></form>',
    ].join('');
    document.body.appendChild(panel);

    var messagesEl = document.getElementById('vp-chat-messages');
    var form = document.getElementById('vp-chat-form');
    var input = document.getElementById('vp-chat-input');
    var sendBtn = document.getElementById('vp-chat-send');
    var closeBtn = document.getElementById('vp-chat-close');
    var sending = false;

    function addMessage(text, role) {
      var div = document.createElement('div');
      div.className = 'vp-msg ' + role;
      div.innerHTML = escapeHtml(text);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function loadHistory() {
      var history = getHistory();
      if (history.length === 0) {
        addMessage("Hi! I can help you set up VaultProof. What are you working on?", 'bot');
      } else {
        history.forEach(function (m) { addMessage(m.text, m.role); });
      }
    }

    function toggle(open) {
      panel.classList.toggle('open', open);
      localStorage.setItem(STATE_KEY, open ? '1' : '0');
    }

    bubble.addEventListener('click', function () { toggle(!panel.classList.contains('open')); });
    closeBtn.addEventListener('click', function () { toggle(false); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = input.value.trim();
      if (!msg || sending) return;

      addMessage(msg, 'user');
      input.value = '';
      sending = true;
      sendBtn.disabled = true;

      var history = getHistory();
      history.push({ text: msg, role: 'user' });

      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: getSessionId(), message: msg }),
      })
        .then(function (res) {
          if (!res.ok) {
            if (res.status === 429) throw new Error('Too many messages — please wait a moment.');
            throw new Error('Something went wrong. Please try again.');
          }
          return res.json();
        })
        .then(function (data) {
          var reply = data.reply || 'Sorry, I could not generate a response.';
          addMessage(reply, 'bot');
          history.push({ text: reply, role: 'bot' });
          saveHistory(history);
        })
        .catch(function (err) {
          addMessage(err.message, 'bot');
        })
        .finally(function () {
          sending = false;
          sendBtn.disabled = false;
          input.focus();
        });
    });

    // Restore state
    loadHistory();
    if (localStorage.getItem(STATE_KEY) === '1') toggle(true);
  }

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
```

**Step 2: Commit**

```bash
git add apps/site/js/chat-widget.js
git commit -m "feat(chat): add floating chat widget (vanilla JS)"
```

---

### Task 7: Inject Widget into All Site Pages

**Files:**
- Modify: All 29 HTML files in `apps/site/`

**Step 1: Add the widget script tag to every HTML file**

Add this line just before the closing `</body>` tag in every `.html` file under `apps/site/`:

```html
<script src="/js/chat-widget.js" defer></script>
```

Full list of files (29 total):

```
apps/site/index.html
apps/site/compare.html
apps/site/status.html
apps/site/changelog.html
apps/site/v2.html
apps/site/terms.html
apps/site/agents.html
apps/site/security.html
apps/site/guides.html
apps/site/abuse.html
apps/site/verify.html
apps/site/demo.html
apps/site/docs.html
apps/site/pitchdeck.html
apps/site/mcp-auth.html
apps/site/privacy.html
apps/site/vp-admin.html
apps/site/app/index.html
apps/site/app/plans.html
apps/site/app/scanner.html
apps/site/app/keys.html
apps/site/app/login.html
apps/site/app/agents.html
apps/site/app/logs.html
apps/site/app/settings.html
apps/site/blog/index.html
apps/site/blog/vaultproof-vs-doppler-vault.html
apps/site/blog/secure-openai-api-key.html
apps/site/blog/vibe-coding-leaking-secrets.html
```

Use a script to inject automatically:

```bash
cd apps/site
for f in $(find . -name "*.html" -type f); do
  # Only add if not already present
  if ! grep -q 'chat-widget.js' "$f"; then
    sed -i '' 's|</body>|<script src="/js/chat-widget.js" defer></script>\n</body>|' "$f"
  fi
done
```

**Step 2: Verify injection worked**

```bash
grep -r 'chat-widget.js' apps/site/ | wc -l
```

Expected: 29

**Step 3: Commit**

```bash
git add apps/site/
git commit -m "feat(chat): inject chat widget script into all site pages"
```

---

### Task 8: Inject Widget into Dashboard (Next.js)

**Files:**
- Modify: `apps/dashboard/src/app/layout.tsx`
- Create: `apps/dashboard/public/js/chat-widget.js` (symlink or copy)

**Important:** Read `node_modules/next/dist/docs/` first for any Next.js 16 Script API changes before implementing.

**Step 1: Copy widget to dashboard public dir**

```bash
mkdir -p apps/dashboard/public/js
cp apps/site/js/chat-widget.js apps/dashboard/public/js/chat-widget.js
```

**Step 2: Add Script tag to layout.tsx**

Add a `<script>` tag in the `<body>` of the root layout. Check Next.js 16 docs first — if `next/script` is available:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// ... existing font config ...

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Script src="/js/chat-widget.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
```

If `next/script` is deprecated in Next.js 16, use a plain `<script>` tag with `defer` instead.

**Step 3: Commit**

```bash
git add apps/dashboard/public/js/chat-widget.js apps/dashboard/src/app/layout.tsx
git commit -m "feat(chat): add chat widget to dashboard layout"
```

---

### Task 9: Deploy Hindsight on Railway

**This is a manual/infra task — not code.**

**Step 1: Create new Railway service**

In the Railway dashboard, create a new service in the existing VaultProof project:
- Name: `hindsight`
- Image: `ghcr.io/vectorize-io/hindsight:latest`
- Port: `8888`

**Step 2: Set environment variables**

```
HINDSIGHT_API_LLM_PROVIDER=minimax
HINDSIGHT_API_LLM_API_KEY=<your-minimax-api-key>
HINDSIGHT_DB_PASSWORD=<generate-strong-password>
```

If using Supabase PostgreSQL instead of embedded:
```
DATABASE_URL=postgresql://postgres:<password>@<supabase-host>:5432/postgres
```

**Step 3: Set up custom domain**

Point `hindsight.vaultproof.dev` to the Railway service.

**Step 4: Verify it's running**

```bash
curl https://hindsight.vaultproof.dev/health
```

Expected: `200 OK`

**Step 5: Test retain/recall**

```bash
# Retain
curl -X POST https://hindsight.vaultproof.dev/v1/retain \
  -H 'Content-Type: application/json' \
  -d '{"bank_id":"test-123","content":"Alice is setting up OpenAI proxy"}'

# Recall
curl -X POST https://hindsight.vaultproof.dev/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"bank_id":"test-123","query":"What is Alice doing?"}'
```

**Step 6: Set worker secret**

```bash
cd packages/worker
wrangler secret put MINIMAX_API_KEY
# Paste your Minimax API key
```

---

### Task 10: End-to-End Testing

**Step 1: Deploy worker to staging**

```bash
cd packages/worker
wrangler deploy --env staging
```

**Step 2: Test chat endpoint directly**

```bash
curl -X POST https://staging-api.vaultproof.dev/api/v1/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"550e8400-e29b-41d4-a716-446655440000","message":"How do I store my OpenAI key?"}'
```

Expected: `{ "reply": "..." }` with a helpful VaultProof-specific response.

**Step 3: Test rate limiting**

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging-api.vaultproof.dev/api/v1/chat/message \
    -H 'Content-Type: application/json' \
    -d '{"session_id":"550e8400-e29b-41d4-a716-446655440000","message":"hi"}'
done
```

Expected: First 10 return `200`, last 2 return `429`.

**Step 4: Test widget on staging site**

Open `https://dev.vaultproof.pages.dev` in a browser. Verify:
- Chat bubble appears bottom-right
- Clicking opens the panel
- Sending a message returns a response
- Closing and reopening preserves history
- Off-topic questions get redirected

**Step 5: Test memory persistence**

1. Ask: "I'm trying to set up OpenAI proxy"
2. Close the tab, reopen
3. Ask: "What was I working on?"
4. Bot should recall OpenAI proxy setup context

**Step 6: Deploy to production**

```bash
cd packages/worker
wrangler deploy
```

**Step 7: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix(chat): adjustments from end-to-end testing"
```

---

### Task 11: Update Staging ALLOWED_ORIGINS

**Files:**
- Modify: `packages/worker/wrangler.toml`

The staging environment already has `ALLOWED_ORIGINS = "*"` so no change needed for staging. For production, verify `ALLOWED_ORIGINS` includes the site domain (already does: `https://vaultproof.dev`).

No action needed — this is a verification step only.
