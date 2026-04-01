# Auto-Migration Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the scanner page to detect API keys, SDK inits, and raw HTTP calls, then create a guided migration PR that rewrites code to use VaultProof's transparent proxy — with user approval at every step.

**Architecture:** Extends existing scanner backend (`POST /scan` and `POST /create-pr`) with new detection patterns for SDK inits and HTTP URLs. Frontend adds a migration wizard flow after scan results. Keys are stored via existing `/sdk/store` endpoint. Dev key auto-created via existing `/dev-keys/create` endpoint. All changes shown to user before PR creation.

**Tech Stack:** Fastify backend (TypeScript), vanilla HTML/JS frontend, GitHub API for PR creation, existing Shamir splitting infrastructure.

---

## Task 1: Extend Scanner Backend — Detect SDK Inits and Raw HTTP Calls

**Files:**
- Modify: `packages/backend/src/routes/scanner.ts:401-510`

**Step 1: Add provider URL map constant**

Add after the existing `KEY_PREFIX_PATTERNS` (around line 75):

```typescript
const PROVIDER_URLS: Record<string, string> = {
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'api.together.xyz': 'together',
  'api.mistral.ai': 'mistral',
  'api.cohere.ai': 'cohere',
  'api.groq.com': 'groq',
  'api.perplexity.ai': 'perplexity',
  'api.fireworks.ai': 'fireworks',
  'api.deepseek.com': 'deepseek',
  'api.replicate.com': 'replicate',
};

const SDK_INIT_PATTERNS: Array<{ regex: RegExp; provider: string; lang: string }> = [
  // JavaScript/TypeScript
  { regex: /new\s+OpenAI\s*\(/g, provider: 'openai', lang: 'js' },
  { regex: /new\s+Anthropic\s*\(/g, provider: 'anthropic', lang: 'js' },
  { regex: /new\s+GoogleGenerativeAI\s*\(/g, provider: 'google', lang: 'js' },
  // Python
  { regex: /OpenAI\s*\(/g, provider: 'openai', lang: 'py' },
  { regex: /Anthropic\s*\(/g, provider: 'anthropic', lang: 'py' },
  { regex: /genai\.configure\s*\(/g, provider: 'google', lang: 'py' },
];
```

**Step 2: Add SDK init detection to the scan loop**

Inside the source file scanning section (after line 472 where it scans for quoted strings), add logic to also scan each file for:
- SDK init patterns from `SDK_INIT_PATTERNS`
- Raw HTTP URLs matching `PROVIDER_URLS` keys (regex: `https?://(api\.openai\.com|api\.anthropic\.com|...)`)
- Env var references: `process\.env\.(OPENAI_API_KEY|ANTHROPIC_API_KEY|...)` and `os\.environ\[["'](OPENAI_API_KEY|...)["']\]`

Store these as new ScanFinding records with:
- `mode: 'sdk-init'` for SDK initializations
- `mode: 'http-url'` for raw HTTP calls
- `mode: 'env-ref'` for env var references
- `envName`: the detected env var or provider name
- `provider`: detected provider
- `file`: file path
- `line`: line number

**Step 3: Run existing tests to verify nothing breaks**

Run: `cd packages/backend && npm test`
Expected: All existing tests still pass

**Step 4: Commit**

```bash
git add packages/backend/src/routes/scanner.ts
git commit -m "feat(scanner): detect SDK inits, raw HTTP URLs, and env var references"
```

---

## Task 2: Extend PR Creation — Rewrite SDK Inits and URLs

**Files:**
- Modify: `packages/backend/src/routes/scanner.ts:630-772`

**Step 1: Add URL rewriting logic to the create-pr endpoint**

In the file rewriting section (lines 669-699), extend the replacement logic to handle the new finding modes:

For `mode: 'sdk-init'` findings:
- Find the SDK init pattern in the file
- Add `baseURL: 'https://api.vaultproof.dev/v1/{provider}'` parameter
- Replace any `apiKey: process.env.{PROVIDER}_API_KEY` with `apiKey: process.env.VAULTPROOF_API_KEY`

For `mode: 'http-url'` findings:
- Replace provider domain with `api.vaultproof.dev/v1/{provider}`
- Replace auth header env var references with `VAULTPROOF_API_KEY`

For `mode: 'env-ref'` findings:
- Replace `process.env.{PROVIDER}_API_KEY` with `process.env.VAULTPROOF_API_KEY`
- Replace `os.environ["{PROVIDER}_API_KEY"]` with `os.environ["VAULTPROOF_API_KEY"]`

For `.env` file findings:
- Remove individual provider key lines
- Add `VAULTPROOF_API_KEY=vp_live_xxx` (placeholder — actual key inserted during migration flow)
- Add comments: `# {PROVIDER}_API_KEY — secured by VaultProof proxy`

**Step 2: Test the rewriting logic manually**

Create test input strings and verify the regex replacements produce correct output.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/scanner.ts
git commit -m "feat(scanner): rewrite SDK inits, HTTP URLs, and env vars in PR creation"
```

---

## Task 3: Add Migration Endpoint — Store Keys + Create Dev Key + Create PR

**Files:**
- Modify: `packages/backend/src/routes/scanner.ts`

**Step 1: Add POST /scans/:scanId/migrate endpoint**

Add a new endpoint after the existing create-pr endpoint (after line 772). This endpoint orchestrates the full migration:

```typescript
app.post('/scans/:scanId/migrate', { preHandler: requireAuth }, async (request, reply) => {
  // 1. Validate scan ownership
  // 2. Accept: { findings: [{ findingId, action, rawKey? }], createDevKey: boolean }
  // 3. For each finding with action 'store':
  //    - Shamir split the raw key (using @vaultproof/shamir)
  //    - Encrypt shares (share1 with VAULT_ENCRYPTION_KEY, share2 with vp_live_ key)
  //    - Store via prisma.keySlot.create()
  // 4. If createDevKey is true and user has no dev keys:
  //    - Create a vp_live_ key via same logic as dev-keys create endpoint
  //    - Return the full key (shown once)
  // 5. Create PR with all approved code changes (reuse create-pr logic)
  // 6. Return: { prUrl, prNumber, devKey?, storedKeys: [{keyId, provider}] }
});
```

**Step 2: Test endpoint with a mock scan**

**Step 3: Commit**

```bash
git add packages/backend/src/routes/scanner.ts
git commit -m "feat(scanner): add /migrate endpoint for guided migration flow"
```

---

## Task 4: Add Platform Detection Endpoint

**Files:**
- Modify: `packages/backend/src/routes/scanner.ts`

**Step 1: Add platform detection to scan results**

During the scan (Task 1 area), also detect hosting platform config files in the repo tree:

```typescript
const PLATFORM_FILES: Record<string, string> = {
  'vercel.json': 'Vercel',
  'railway.toml': 'Railway',
  'fly.toml': 'Fly.io',
  'render.yaml': 'Render',
  'netlify.toml': 'Netlify',
  'Dockerfile': 'Docker',
  'docker-compose.yml': 'Docker Compose',
  'docker-compose.yaml': 'Docker Compose',
  '.github/workflows': 'GitHub Actions',
};
```

Check the repo file tree for these paths. Return detected platforms in the scan response:

```json
{
  "platforms": ["Vercel", "GitHub Actions"],
  ...existing fields
}
```

**Step 2: Commit**

```bash
git add packages/backend/src/routes/scanner.ts
git commit -m "feat(scanner): detect hosting platforms from repo config files"
```

---

## Task 5: Frontend — Add Migration Wizard to Scanner Page

**Files:**
- Modify: `apps/site/app/scanner.html`

**Step 1: Add migration results view**

After the existing scan results section (around line 395), add a new state for migration results that shows findings grouped by type:

- **Keys found** section — list of API keys with provider, file, masked value
- **SDK inits found** section — list of SDK initialization points with file:line
- **Raw HTTP calls found** section — list of provider URL calls with file:line
- **"Migrate to VaultProof" button** — prominent CTA

**Step 2: Add review changes modal**

New modal that shows before/after diffs for each file. Each change has a checkbox (checked by default). User can uncheck any change to skip it.

Layout:
- File path header
- Before: red highlighted old code
- After: green highlighted new code
- Checkbox: "Apply this change"

Bottom: "Confirm Migration" button (only enabled when at least one change is checked)

**Step 3: Commit**

```bash
git add apps/site/app/scanner.html
git commit -m "feat(scanner-ui): add migration results view and review changes modal"
```

---

## Task 6: Frontend — Progress Animations

**Files:**
- Modify: `apps/site/app/scanner.html`

**Step 1: Add scan progress animation**

Replace the existing scan spinner with a multi-step progress display:

```html
<div id="scanProgress" class="hidden">
  <div class="space-y-3">
    <div id="scanStep1" class="flex items-center gap-3 text-sm text-gray-400">
      <div class="w-5 h-5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
      Scanning .env files...
    </div>
    <!-- More steps added dynamically -->
  </div>
  <div id="findingsCounter" class="mt-4 text-sm text-gray-500">
    Found: <span id="keysCount">0</span> keys, <span id="initsCount">0</span> SDK inits, <span id="urlsCount">0</span> HTTP calls
  </div>
</div>
```

Update `startScan()` to show each step as it progresses and animate findings sliding in.

**Step 2: Add migration progress animation**

After user clicks "Confirm Migration", show step-by-step progress:

```html
<div id="migrateProgress" class="hidden space-y-4">
  <div class="flex items-center gap-3" id="migrateStep1">
    <div class="w-6 h-6 rounded-full border-2 border-gray-600 flex items-center justify-center">
      <svg class="w-3.5 h-3.5 hidden" ...><!-- checkmark --></svg>
    </div>
    <span>Storing API keys securely...</span>
  </div>
  <div class="flex items-center gap-3" id="migrateStep2">...</div>
  <div class="flex items-center gap-3" id="migrateStep3">...</div>
  <div class="flex items-center gap-3" id="migrateStep4">...</div>
</div>
```

Each step transitions from spinner → green checkmark as it completes.

**Step 3: Commit**

```bash
git add apps/site/app/scanner.html
git commit -m "feat(scanner-ui): add scan and migration progress animations"
```

---

## Task 7: Frontend — Env Var Checklist

**Files:**
- Modify: `apps/site/app/scanner.html`

**Step 1: Add post-PR checklist view**

After migration completes and PR is created, show the env var checklist. This replaces the current "PR created" success state.

```html
<div id="envChecklist" class="hidden space-y-6">
  <h3 class="text-lg font-semibold text-white">Update your environment variables</h3>
  <p class="text-sm text-gray-400">Before you merge the PR, update these in your hosting platform.</p>

  <!-- Remove section — populated dynamically from stored keys -->
  <div id="envRemoveSection">
    <h4 class="text-sm font-medium text-red-400 mb-2">Remove these</h4>
    <!-- Checkboxes generated per stored key -->
  </div>

  <!-- Add section -->
  <div id="envAddSection">
    <h4 class="text-sm font-medium text-green-400 mb-2">Add this</h4>
    <!-- VAULTPROOF_API_KEY with copy button -->
  </div>

  <!-- Keep section — populated from non-proxyable env vars -->
  <div id="envKeepSection">
    <h4 class="text-sm font-medium text-gray-400 mb-2">Keep these (not affected)</h4>
    <!-- List of DATABASE_URL, STRIPE_SECRET_KEY, etc. -->
  </div>

  <!-- Platform instructions — populated from detected platforms -->
  <div id="platformInstructions">
    <h4 class="text-sm font-medium text-gray-400 mb-2">Where to update</h4>
    <!-- Platform-specific instructions -->
  </div>

  <!-- Merge button — enabled when all checkboxes checked -->
  <a id="mergePrBtn" href="#" target="_blank" class="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl text-sm font-semibold opacity-50 pointer-events-none">
    Ready to merge — Open PR
  </a>
</div>
```

**Step 2: Add JavaScript to populate checklist**

```javascript
function showEnvChecklist(data) {
  // data = { prUrl, storedKeys, devKey, platforms, envVars }
  // Populate remove section from storedKeys (provider-specific env vars)
  // Populate add section with VAULTPROOF_API_KEY + copy button
  // Populate keep section by filtering .env vars that aren't proxy-supported
  // Populate platform instructions from detected platforms
  // Enable merge button when all remove + add checkboxes are checked
}
```

**Step 3: Add platform instruction templates**

```javascript
const PLATFORM_INSTRUCTIONS = {
  'Vercel': 'Go to <a href="https://vercel.com" target="_blank">Vercel</a> → Your Project → Settings → Environment Variables',
  'Railway': 'Go to <a href="https://railway.app" target="_blank">Railway</a> → Your Service → Variables',
  'Fly.io': 'Run: <code>fly secrets set VAULTPROOF_API_KEY=vp_live_xxx</code>',
  'Render': 'Go to <a href="https://render.com" target="_blank">Render</a> → Your Service → Environment',
  'Netlify': 'Go to <a href="https://netlify.com" target="_blank">Netlify</a> → Site settings → Environment variables',
  'Docker': 'Add <code>-e VAULTPROOF_API_KEY=vp_live_xxx</code> to your docker run command',
  'Docker Compose': 'Add <code>VAULTPROOF_API_KEY=vp_live_xxx</code> to your environment section',
  'GitHub Actions': 'Go to GitHub → Your Repo → Settings → Secrets and variables → Actions → New repository secret',
};
```

**Step 4: Commit**

```bash
git add apps/site/app/scanner.html
git commit -m "feat(scanner-ui): add post-PR env var checklist with platform detection"
```

---

## Task 8: Wire It All Together

**Files:**
- Modify: `apps/site/app/scanner.html`

**Step 1: Connect the full flow**

Update the scanner page JavaScript to chain the states:

1. `startScan()` → shows scan progress → renders migration results
2. Click "Migrate to VaultProof" → opens review changes modal
3. Click "Confirm Migration" → calls `POST /scans/:scanId/migrate` → shows migration progress
4. Migration complete → shows env var checklist with PR link

```javascript
async function startMigration(scanId, approvedChanges) {
  showMigrateProgress();

  // Step 1: Store keys
  updateMigrateStep(1, 'loading');
  // ... call migrate endpoint
  updateMigrateStep(1, 'done', `${data.storedKeys.length} keys stored`);

  // Step 2: Dev key
  updateMigrateStep(2, 'loading');
  // ... included in migrate response
  updateMigrateStep(2, 'done', 'vp_live_xxx created');

  // Step 3: Code changes
  updateMigrateStep(3, 'loading');
  // ... included in migrate response
  updateMigrateStep(3, 'done', `${approvedChanges.length} files updated`);

  // Step 4: PR
  updateMigrateStep(4, 'loading');
  // ... included in migrate response
  updateMigrateStep(4, 'done', `PR #${data.prNumber} created`);

  // Show checklist
  showEnvChecklist(data);
}
```

**Step 2: Remove the old "Create PR" modal** — replaced by the new migration flow

**Step 3: Test full flow manually** — connect a test repo, scan, review, migrate

**Step 4: Commit**

```bash
git add apps/site/app/scanner.html
git commit -m "feat(scanner-ui): wire full migration flow end-to-end"
```

---

## Task 9: Update Scanner Page Free Access

**Files:**
- Modify: `packages/backend/src/routes/scanner.ts`
- Modify: `apps/site/app/scanner.html`

**Step 1: Remove Pro plan requirement from scanner**

In the backend, find where the scanner checks for Pro tier (likely in the GitHub connect or scan endpoints) and remove or bypass the check so free users can access the full migration flow.

**Step 2: Update frontend to remove Pro upgrade prompts**

Remove any "Upgrade to Pro" gates in the scanner UI.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/scanner.ts apps/site/app/scanner.html
git commit -m "feat(scanner): make migration flow free for all users"
```

---

## Task 10: Final Integration Test and Cleanup

**Step 1: Kill the local test server if still running**

```bash
lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill 2>/dev/null
```

**Step 2: Verify all files are clean**

```bash
cd /Users/nelson/projects/zkvault && git status
```

**Step 3: Push all changes**

```bash
git push origin main
```
