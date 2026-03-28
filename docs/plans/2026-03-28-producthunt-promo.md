# Product Hunt Promo System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give away 200 Pro accounts for 1 year via Product Hunt, with weekly feedback prompts and full admin tracking.

**Architecture:** Add `promoCode` and `tierExpiresAt` fields to User model. New `PromoFeedback` table for weekly responses. Promo redemption happens at first login via `?promo=PRODUCTHUNT` param. Auth middleware checks tier expiry on every request. Admin panel gets a Promo tab to track all redemptions and feedback.

**Tech Stack:** Prisma (Postgres), Fastify backend, static HTML frontend, Supabase OAuth

---

### Task 1: Schema — add promo fields to User + PromoFeedback table

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

**Step 1: Add fields to User model and new PromoFeedback model**

Add to User model (after `killSwitch` line):
```prisma
  promoCode        String?   @map("promo_code")       // e.g. "PRODUCTHUNT"
  tierExpiresAt    DateTime? @map("tier_expires_at")   // when promo tier reverts to free
```

Add new model:
```prisma
model PromoFeedback {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id])
  feedback  String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("promo_feedback")
}
```

Add `promoFeedback PromoFeedback[]` relation to User model.

**Step 2: Generate and run migration**

```bash
cd packages/backend && npx prisma migrate dev --name add-promo-fields
```

**Step 3: Commit**

```bash
git add packages/backend/prisma/
git commit -m "schema: add promoCode, tierExpiresAt, PromoFeedback table"
```

---

### Task 2: Backend — promo redemption endpoint

**Files:**
- Create: `packages/backend/src/routes/promo.ts`
- Modify: `packages/backend/src/index.ts` (register route)

**Step 1: Create promo routes**

`packages/backend/src/routes/promo.ts`:
```typescript
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const PROMO_CODES: Record<string, { tier: string; durationDays: number; maxRedemptions: number }> = {
  PRODUCTHUNT: { tier: 'pro', durationDays: 365, maxRedemptions: 200 },
};

export async function promoRoutes(app: FastifyInstance) {
  // Redeem a promo code
  app.post('/redeem', { preHandler: requireAuth }, async (request, reply) => {
    const { code } = request.body as { code: string };
    const promoCode = (code || '').toUpperCase().trim();
    const promo = PROMO_CODES[promoCode];

    if (!promo) {
      return reply.status(400).send({ error: 'Invalid promo code' });
    }

    // Check if user already redeemed
    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (user?.promoCode) {
      return reply.status(400).send({ error: 'You have already redeemed a promo code' });
    }

    // Check hard cap
    const redeemed = await prisma.user.count({ where: { promoCode } });
    if (redeemed >= promo.maxRedemptions) {
      return reply.status(410).send({ error: 'All promo spots have been claimed' });
    }

    // Apply promo
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + promo.durationDays);

    await prisma.user.update({
      where: { id: request.auth!.userId },
      data: { tier: promo.tier, promoCode, tierExpiresAt: expiresAt },
    });

    return { message: 'Promo applied!', tier: promo.tier, expiresAt };
  });

  // Check promo code validity (no auth needed — for showing UI state)
  app.get('/check/:code', async (request) => {
    const { code } = request.params as { code: string };
    const promoCode = code.toUpperCase().trim();
    const promo = PROMO_CODES[promoCode];

    if (!promo) return { valid: false };

    const redeemed = await prisma.user.count({ where: { promoCode } });
    return { valid: true, spotsLeft: promo.maxRedemptions - redeemed, tier: promo.tier };
  });

  // Submit weekly feedback
  app.post('/feedback', { preHandler: requireAuth }, async (request, reply) => {
    const { feedback } = request.body as { feedback: string };
    if (!feedback || feedback.trim().length < 3) {
      return reply.status(400).send({ error: 'Feedback is too short' });
    }

    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user?.promoCode) {
      return reply.status(400).send({ error: 'No active promo' });
    }

    await prisma.promoFeedback.create({
      data: { userId: request.auth!.userId, feedback: feedback.trim() },
    });

    return { message: 'Thanks for the feedback!' };
  });

  // Get feedback status (has user submitted this week?)
  app.get('/feedback/status', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user?.promoCode) return { isPromo: false };

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recentFeedback = await prisma.promoFeedback.findFirst({
      where: { userId: request.auth!.userId, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      isPromo: true,
      promoCode: user.promoCode,
      tierExpiresAt: user.tierExpiresAt,
      submittedThisWeek: !!recentFeedback,
      lastSubmitted: recentFeedback?.createdAt || null,
    };
  });
}
```

**Step 2: Register route in index.ts**

Add import and registration in `packages/backend/src/index.ts`:
```typescript
import { promoRoutes } from './routes/promo.js';
// ... after other API routes:
await app.register(promoRoutes, { prefix: '/api/v1/promo' });
```

**Step 3: Commit**

```bash
git add packages/backend/src/routes/promo.ts packages/backend/src/index.ts
git commit -m "feat: promo code redemption + weekly feedback endpoints"
```

---

### Task 3: Backend — tier expiry check in auth middleware

**Files:**
- Modify: `packages/backend/src/middleware/auth.ts`

**Step 1: Add expiry check after user lookup**

After the `request.auth = { userId: dbUser.id, email: dbUser.email };` line, add:

```typescript
  // Auto-expire promo tiers
  if (dbUser.tierExpiresAt && dbUser.tierExpiresAt < new Date() && dbUser.promoCode) {
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { tier: 'free', tierExpiresAt: null },
    });
  }
```

**Step 2: Commit**

```bash
git add packages/backend/src/middleware/auth.ts
git commit -m "feat: auto-expire promo tiers on login"
```

---

### Task 4: Frontend — login page promo detection + auto-redeem

**Files:**
- Modify: `apps/site/app/login.html`

**Step 1: Detect `?promo=` param and store in localStorage**

Add near top of the `<script>` section (after Supabase client init):
```javascript
// Promo code detection
const urlParams = new URLSearchParams(window.location.search);
const promoCode = urlParams.get('promo');
if (promoCode) localStorage.setItem('vp_promo', promoCode.toUpperCase());
```

**Step 2: Show promo banner if code present**

Add a banner element before the login form:
```html
<div id="promoBanner" class="hidden mb-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-center">
  <div class="text-sm font-medium text-indigo-400">🎉 Product Hunt Promo</div>
  <div class="text-xs text-gray-400 mt-1">Sign up to claim your free Pro account for 1 year</div>
  <div id="promoSpots" class="text-xs text-gray-500 mt-1"></div>
</div>
```

Show banner if promo code exists:
```javascript
if (localStorage.getItem('vp_promo')) {
  document.getElementById('promoBanner').classList.remove('hidden');
}
```

**Step 3: After successful login/signup, auto-redeem promo**

In the `onAuthStateChange` callback (or after session is established), add:
```javascript
const pendingPromo = localStorage.getItem('vp_promo');
if (pendingPromo && session) {
  try {
    const res = await fetch(API_URL + '/api/v1/promo/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ code: pendingPromo }),
    });
    if (res.ok) localStorage.removeItem('vp_promo');
  } catch (e) { console.error('Promo redeem failed:', e); }
}
```

**Step 4: Commit**

```bash
git add apps/site/app/login.html
git commit -m "feat: auto-redeem promo code on signup via ?promo= param"
```

---

### Task 5: Frontend — weekly feedback nudge in dashboard

**Files:**
- Modify: `apps/site/app/index.html` (main dashboard page)

**Step 1: Add feedback modal HTML**

Add before closing `</body>`:
```html
<!-- Promo Feedback Nudge -->
<div id="feedbackNudge" class="hidden fixed bottom-6 right-6 z-50 bg-[#111118] border border-[#6366f1]/30 rounded-2xl p-5 shadow-2xl shadow-black/50 max-w-sm" style="animation: fadeIn 0.3s ease">
  <div class="text-sm font-semibold text-white mb-1">How's VaultProof working for you?</div>
  <div class="text-xs text-gray-500 mb-3">Share a quick thought — helps us improve!</div>
  <textarea id="feedbackText" rows="3" class="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl px-3 py-2 text-sm text-gray-300 focus:border-[#6366f1] focus:outline-none resize-none" placeholder="What would you improve?"></textarea>
  <div class="flex gap-2 mt-3">
    <button onclick="submitFeedback()" class="flex-1 px-4 py-2 bg-[#6366f1] hover:bg-[#5558e6] text-white rounded-xl text-sm font-medium transition">Submit</button>
    <button onclick="dismissFeedback()" class="px-4 py-2 text-gray-500 hover:text-gray-300 text-sm transition">Later</button>
  </div>
</div>
```

**Step 2: Add JS to check feedback status and show nudge**

```javascript
async function checkPromoFeedback() {
  try {
    const res = await apiFetch('/promo/feedback/status');
    if (!res) return;
    const data = await res.json();
    if (data.isPromo && !data.submittedThisWeek) {
      document.getElementById('feedbackNudge').classList.remove('hidden');
    }
  } catch (e) { /* silently ignore */ }
}

async function submitFeedback() {
  const text = document.getElementById('feedbackText').value.trim();
  if (!text) return;
  try {
    await apiFetch('/promo/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: text }),
    });
    document.getElementById('feedbackNudge').classList.add('hidden');
  } catch (e) { console.error('Feedback submit failed:', e); }
}

function dismissFeedback() {
  document.getElementById('feedbackNudge').classList.add('hidden');
}

// Call on page load after auth
checkPromoFeedback();
```

**Step 3: Commit**

```bash
git add apps/site/app/index.html
git commit -m "feat: weekly feedback nudge for promo users"
```

---

### Task 6: Admin — Promo tab with redemptions + feedback

**Files:**
- Modify: `packages/backend/src/routes/admin.ts` (add promo endpoints)
- Modify: `apps/site/vp-admin.html` (add Promo tab)

**Step 1: Add admin promo endpoints**

In `admin.ts`, add inside `adminRoutes` function:

```typescript
  // ─── Promo stats ────────────────────────────────────────────────
  app.get('/promo/stats', async () => {
    const [totalRedeemed, feedback] = await Promise.all([
      prisma.user.count({ where: { promoCode: { not: null } } }),
      prisma.promoFeedback.count(),
    ]);

    const byCode = await prisma.user.groupBy({
      by: ['promoCode'],
      where: { promoCode: { not: null } },
      _count: { id: true },
    });

    return { totalRedeemed, totalFeedback: feedback, byCode };
  });

  // ─── Promo users list ──────────────────────────────────────────
  app.get('/promo/users', async (request) => {
    const { page, limit } = request.query as { page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const take = Math.min(200, Math.max(1, parseInt(limit || '50', 10)));
    const skip = (pageNum - 1) * take;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: { promoCode: { not: null } },
        skip, take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, tier: true, promoCode: true,
          tierExpiresAt: true, createdAt: true,
          _count: { select: { promoFeedback: true } },
        },
      }),
      prisma.user.count({ where: { promoCode: { not: null } } }),
    ]);

    return { users, total, page: pageNum, limit: take };
  });

  // ─── All feedback ──────────────────────────────────────────────
  app.get('/promo/feedback', async (request) => {
    const { page, limit } = request.query as { page?: string; limit?: string };
    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const take = Math.min(200, Math.max(1, parseInt(limit || '50', 10)));
    const skip = (pageNum - 1) * take;

    const [feedback, total] = await Promise.all([
      prisma.promoFeedback.findMany({
        skip, take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, feedback: true, createdAt: true,
          user: { select: { email: true, promoCode: true } },
        },
      }),
      prisma.promoFeedback.count(),
    ]);

    return { feedback, total, page: pageNum, limit: take };
  });
```

**Step 2: Add Promo tab to vp-admin.html**

Add tab button:
```html
<div class="tab" data-tab="promo" onclick="switchTab('promo')">Promo</div>
```

Update `switchTab` to include 'promo' in the tab list.

Add tab content with: promo stats cards (redeemed/200, total feedback), promo users table, and feedback table.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/admin.ts apps/site/vp-admin.html
git commit -m "feat: admin Promo tab — track redemptions, feedback, spots left"
```

---

### Task 7: Settings page — show promo badge + expiry

**Files:**
- Modify: `apps/site/app/settings.html`

**Step 1: Update billing section to show promo status**

When `loadBillingStatus()` returns a user with a `promoCode`, show:
- Badge: "Pro (Product Hunt)" instead of just "Pro"
- Expiry date: "Expires: Mar 28, 2027"
- Hide upgrade cards for promo users

This requires the `/billing/status` endpoint to also return `promoCode` and `tierExpiresAt`. Check if it does — if not, add those fields to the response.

**Step 2: Commit**

```bash
git add apps/site/app/settings.html
git commit -m "feat: show promo badge and expiry in settings"
```

---

### Task 8: Final — push and deploy

**Step 1: Push to GitHub**
```bash
git push
```

**Step 2: Deploy worker**
```bash
cd packages/worker && npx wrangler deploy
```

**Step 3: Verify**
- Visit `vaultproof.dev/app/login?promo=PRODUCTHUNT`
- Sign up → should auto-upgrade to Pro
- Check admin panel Promo tab → should show redemption
- Check settings → should show "Pro (Product Hunt)" badge
