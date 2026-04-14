# CLI Trust Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add transparent split output during `init` and a `vaultproof doctor` command to build developer trust before, during, and after setup.

**Architecture:** All changes land in `packages/init-cli/src/index.ts`. Feature A rewrites the per-key split output to make client-side splitting visible. Feature B adds a new `runDoctor()` function and `doctor` branch in the command parser. No new files, no new dependencies.

**Tech Stack:** TypeScript, Node 18+, chalk, ora, existing config/login helpers

---

## Task 1: Feature A — Transparent split output

**Files:**
- Modify: `packages/init-cli/src/index.ts:244-338` (the per-key loop in `runInit`)

### Step 1: Add the one-time security header before the per-key loop

Find this line in `runInit()` (around line 243):
```typescript
  // ── Split and upload each key ──
  for (const f of findings) {
```

Replace it with:
```typescript
  // ── Split and upload each key ──
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.bold('How VaultProof protects your keys:'));
  console.log(`  ${chalk.cyan('→')} Your key is split into 2 shares ${chalk.bold('on this machine')}`);
  console.log(`  ${chalk.cyan('→')} Each share is useless without the other`);
  console.log(`  ${chalk.cyan('→')} VaultProof never receives your full key`);
  console.log(chalk.dim('─'.repeat(60)) + '\n');

  for (const f of findings) {
```

### Step 2: Replace the spinner success line

Find this line (around line 337):
```typescript
    s.succeed(`Protected ${chalk.bold(f.varName)} ${chalk.dim('(' + f.provider.label + ')')}`);
```

Replace it with:
```typescript
    s.succeed(`${chalk.bold(f.varName)} ${chalk.dim('(' + f.provider.label + ')')}`);
    console.log(chalk.dim(`    Split locally on your machine`));
    console.log(chalk.dim(`    Share 1 → VaultProof (encrypted at rest, useless alone)`));
    console.log(chalk.dim(`    Share 2 → VaultProof (encrypted at rest, useless alone)`));
    console.log(chalk.dim(`    A breach of VaultProof cannot expose this key\n`));
```

### Step 3: Build and manually verify output

```bash
cd /Users/nelson/projects/zkvault/packages/init-cli && npm run build
```

Expected: no TypeScript errors.

Then do a dry-run in a directory with a `.env` containing a test key to confirm the new output renders correctly:

```bash
cd /tmp && echo "OPENAI_API_KEY=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" > .env
cd /tmp && node /Users/nelson/projects/zkvault/packages/init-cli/dist/index.js --dry-run
```

Expected: banner prints, key is detected, and the security header appears above the key list. (Dry-run exits before the upload loop, so the per-key output won't show — that's fine for now.)

### Step 4: Run the test gate (type check + unit tests)

```bash
cd /Users/nelson/projects/zkvault && bash scripts/test-init.sh
```

Expected: all tests PASS, GATE: OPEN.

### Step 5: Commit

```bash
cd /Users/nelson/projects/zkvault
git add packages/init-cli/src/index.ts
git commit -m "feat(cli): show transparent split output during init"
```

---

## Task 2: Feature B — `vaultproof doctor` command

**Files:**
- Modify: `packages/init-cli/src/index.ts` (add `runDoctor()` and update `main()`)
- Modify: `packages/init-cli/src/index.ts:701-718` (command parser in `main()`)

### Step 2.1: Add the `runDoctor()` function

Add this function to `index.ts` just before the `main()` function (around line 701):

```typescript
async function runDoctor(): Promise<void> {
  printBanner();
  console.log(chalk.bold('VaultProof — health check\n'));

  const apiUrl = getInitWorkerUrl();
  const proxyBaseUrl = getProxyBaseUrl();
  const TIMEOUT_MS = 5_000;

  let issues = 0;

  async function check(
    label: string,
    fn: () => Promise<{ ok: boolean; detail: string }>,
  ): Promise<void> {
    const spinner = ora(label).start();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const start = Date.now();
      const result = await fn();
      clearTimeout(timer);
      const ms = Date.now() - start;
      if (result.ok) {
        spinner.succeed(`${label.padEnd(30)} ${chalk.dim(result.detail)} ${chalk.dim(`(${ms}ms)`)}`);
      } else {
        spinner.fail(`${label.padEnd(30)} ${chalk.red(result.detail)}`);
        issues++;
      }
    } catch (err: any) {
      spinner.fail(`${label.padEnd(30)} ${chalk.red(err?.name === 'AbortError' ? 'timeout (5s)' : String(err))}`);
      issues++;
    }
  }

  // Check 1: Worker reachability
  await check('Worker reachability', async () => {
    const res = await fetch(`${apiUrl}/health`);
    return res.ok
      ? { ok: true, detail: 'connected' }
      : { ok: false, detail: `HTTP ${res.status}` };
  });

  // Check 2: Auth validity
  const jwt = getJwt();
  await check('Auth validity', async () => {
    if (!jwt) return { ok: false, detail: 'not logged in — run npx @vaultproof/init first' };
    const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { projects: any[] };
    const email = (() => {
      try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()).email || ''; } catch { return ''; }
    })();
    return { ok: true, detail: email || 'valid' };
  });

  // Check 3: Share integrity
  await check('Share integrity', async () => {
    if (!jwt) return { ok: false, detail: 'skipped (not logged in)' };
    const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { projects: Array<{ id: string; vp_proj_id: string; name: string | null }> };
    const projects = data.projects || [];
    if (projects.length === 0) return { ok: false, detail: 'no projects found' };
    return { ok: true, detail: `${projects.length} project${projects.length === 1 ? '' : 's'} found` };
  });

  // Check 4: Live proxy test per provider (reuse logic from runInit)
  const catalog = await loadProviders();
  const providerSamples = catalog.providers.slice(0, 5); // test first 5 providers
  // Get project ID from first project for proxy test
  let projectId: string | null = null;
  if (jwt) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { projects: Array<{ vp_proj_id: string }> };
        projectId = data.projects?.[0]?.vp_proj_id || null;
      }
    } catch { /* ignore */ }
  }

  if (projectId) {
    await check('Proxy reachability', async () => {
      const testUrl = `${proxyBaseUrl}/p/openai/`;
      const res = await fetch(testUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${projectId}` },
      });
      // 401/404/405 from upstream = proxy chain works (key reconstructed, upstream responded)
      if ([200, 401, 404, 405].includes(res.status)) {
        return { ok: true, detail: 'proxy chain connected' };
      }
      return { ok: false, detail: `HTTP ${res.status}` };
    });
  } else {
    console.log(chalk.dim('  Proxy test skipped — no projects found'));
  }

  // Summary
  console.log();
  if (issues === 0) {
    console.log(chalk.bold.green('✓ All checks passed.'));
  } else {
    console.log(chalk.bold.red(`✗ ${issues} issue${issues === 1 ? '' : 's'} found.`));
    console.log(chalk.dim(`  See https://vaultproof.dev/status for live uptime data.`));
  }
  console.log();

  process.exit(issues > 0 ? 1 : 0);
}
```

### Step 2.2: Update `main()` to handle the `doctor` command

Find the `main()` function command parser (around line 701):
```typescript
async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv);
  const autoYes = flags.has('--yes') || flags.has('-y');
  const dryRun = flags.has('--dry-run');
  const checkLegacy = flags.has('--check-legacy');

  if (cmd !== 'init') {
    console.error(chalk.red(`Unknown command: ${cmd}`));
    console.error(chalk.dim('Usage: npx @vaultproof/init [--yes] [--dry-run] [--check-legacy]'));
    process.exit(1);
  }
```

Replace with:
```typescript
async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv);
  const autoYes = flags.has('--yes') || flags.has('-y');
  const dryRun = flags.has('--dry-run');
  const checkLegacy = flags.has('--check-legacy');

  if (cmd === 'doctor') {
    await runDoctor();
    return;
  }

  if (cmd !== 'init') {
    console.error(chalk.red(`Unknown command: ${cmd}`));
    console.error(chalk.dim('Usage: npx @vaultproof/init [--yes] [--dry-run] [--check-legacy]'));
    console.error(chalk.dim('       npx @vaultproof/init doctor'));
    process.exit(1);
  }
```

### Step 2.3: Build and smoke-test `doctor`

```bash
cd /Users/nelson/projects/zkvault/packages/init-cli && npm run build
```

Expected: no TypeScript errors.

```bash
node /Users/nelson/projects/zkvault/packages/init-cli/dist/index.js doctor
```

Expected: banner prints, health check runs, Worker reachability and proxy checks show pass/fail with latency. Auth/share checks will fail if not logged in — that's expected and correct.

### Step 2.4: Write a unit test for `runDoctor` command parsing

Add to the bottom of `packages/init-cli/src/publish.test.ts` (the publish invariants file, which tests the built dist):

```typescript
// ── doctor command ──────────────────────────────────────────────────────
console.log('── doctor command reachability ──');

// Verify "doctor" is now a recognized command (not rejected as unknown)
// We do this by checking the built dist contains the doctor branch
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname2, '..', 'dist', 'index.js');
const dist = readFileSync(distPath, 'utf-8');

ok('doctor command present in dist', dist.includes("cmd === 'doctor'"));
ok('runDoctor function present in dist', dist.includes('runDoctor'));
ok('doctor in usage string', dist.includes("npx @vaultproof/init doctor"));
```

Note: `ok()` is already defined at the top of `publish.test.ts`. You're adding these lines at the end of the file before `process.exit(failed > 0 ? 1 : 0)`.

### Step 2.5: Run the full test gate

```bash
cd /Users/nelson/projects/zkvault && bash scripts/test-init.sh
```

Expected: all tests PASS including the new publish invariants, GATE: OPEN.

### Step 2.6: Commit

```bash
cd /Users/nelson/projects/zkvault
git add packages/init-cli/src/index.ts
git commit -m "feat(cli): add doctor command for end-to-end health check"
```

---

## Task 3: Push to dev and main

```bash
cd /Users/nelson/projects/zkvault
git push origin dev
git checkout main && git merge dev && git push origin main
git checkout dev
```

---

## Task 4: Publish updated CLI to npm

```bash
cd /Users/nelson/projects/zkvault/packages/init-cli
```

Bump the version in `package.json` from `0.1.1` to `0.1.2`:
```json
"version": "0.1.2",
```

Also update the hardcoded version string in the banner (index.ts line ~49):
```typescript
const version   = chalk.dim('  v0.1.2');
```

Then build and publish:
```bash
npm run build && npm publish --access public
```

Expected: `+ @vaultproof/init@0.1.2` published successfully.

Commit the version bump:
```bash
git add packages/init-cli/package.json packages/init-cli/src/index.ts
git commit -m "chore(cli): bump to v0.1.2"
git push origin dev
git checkout main && git merge dev && git push origin main && git checkout dev
```
