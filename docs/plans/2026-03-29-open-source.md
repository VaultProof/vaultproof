# Open Source Repo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a new public GitHub repo `github.com/vaultproof/vaultproof` containing the four client-side packages (shamir, circuits, sdk, cli) with a trust-focused README.

**Architecture:** New standalone monorepo using npm workspaces + turborepo, copied from the private monorepo. SDK and CLI depend on `@vaultproof/shamir` via workspace resolution in the new repo. No backend, worker, dashboard, or site included.

**Tech Stack:** npm workspaces, turborepo, TypeScript, Noir (circuits), MIT license

---

### Task 1: Secrets audit — shamir

**Files:**
- Read: `packages/shamir/src/`

**Step 1: Scan shamir for secrets**

Run:
```bash
grep -r "vaultproof.dev\|railway\|supabase\|vp_live_\|VAULT_ENCRYPTION\|api\.vaultproof" /Users/nelson/projects/zkvault/packages/shamir/
```
Expected: no matches. If any found, note them — they must not be copied.

**Step 2: Commit nothing yet** — just note any findings before proceeding.

---

### Task 2: Secrets audit — circuits

**Files:**
- Read: `packages/circuits/src/main.nr`, `packages/circuits/Nargo.toml`

**Step 1: Scan circuits for secrets**

Run:
```bash
grep -r "vaultproof.dev\|railway\|supabase\|vp_live_\|VAULT_ENCRYPTION" /Users/nelson/projects/zkvault/packages/circuits/
```
Expected: no matches.

---

### Task 3: Secrets audit — sdk

**Files:**
- Read: `packages/sdk/src/`

**Step 1: Scan sdk for hardcoded infra references**

Run:
```bash
grep -r "vaultproof.dev\|railway.app\|supabase\|vp_live_\|VAULT_ENCRYPTION\|gwzkjiomemjlhtrdrlan" /Users/nelson/projects/zkvault/packages/sdk/
```
Expected: any `api.vaultproof.dev` references are fine (that's the public API URL, not a secret). Flag anything else.

---

### Task 4: Secrets audit — cli

**Files:**
- Read: `packages/cli/src/`

**Step 1: Scan cli for hardcoded infra references**

Run:
```bash
grep -r "railway.app\|supabase\|vp_live_\|VAULT_ENCRYPTION\|gwzkjiomemjlhtrdrlan" /Users/nelson/projects/zkvault/packages/cli/
```
Expected: same as sdk — `api.vaultproof.dev` is fine, flag anything else.

---

### Task 5: Create new local repo

**Files:**
- Create: `/Users/nelson/projects/vaultproof-open/` (new directory)

**Step 1: Initialize the repo**

Run:
```bash
mkdir -p /Users/nelson/projects/vaultproof-open/packages
cd /Users/nelson/projects/vaultproof-open
git init
```

**Step 2: Copy the four packages**

Run:
```bash
cp -r /Users/nelson/projects/zkvault/packages/shamir /Users/nelson/projects/vaultproof-open/packages/shamir
cp -r /Users/nelson/projects/zkvault/packages/circuits /Users/nelson/projects/vaultproof-open/packages/circuits
cp -r /Users/nelson/projects/zkvault/packages/sdk /Users/nelson/projects/vaultproof-open/packages/sdk
cp -r /Users/nelson/projects/zkvault/packages/cli /Users/nelson/projects/vaultproof-open/packages/cli
```

**Step 3: Remove dist and node_modules from copies**

Run:
```bash
rm -rf /Users/nelson/projects/vaultproof-open/packages/shamir/dist
rm -rf /Users/nelson/projects/vaultproof-open/packages/shamir/node_modules
rm -rf /Users/nelson/projects/vaultproof-open/packages/circuits/target
rm -rf /Users/nelson/projects/vaultproof-open/packages/sdk/dist
rm -rf /Users/nelson/projects/vaultproof-open/packages/sdk/node_modules
rm -rf /Users/nelson/projects/vaultproof-open/packages/cli/dist
rm -rf /Users/nelson/projects/vaultproof-open/packages/cli/node_modules
```

---

### Task 6: Root package.json and turbo config

**Files:**
- Create: `/Users/nelson/projects/vaultproof-open/package.json`
- Create: `/Users/nelson/projects/vaultproof-open/turbo.json`

**Step 1: Write root package.json**

Create `/Users/nelson/projects/vaultproof-open/package.json`:
```json
{
  "name": "vaultproof-open",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "packageManager": "npm@10.9.2",
  "engines": {
    "node": ">=22"
  },
  "devDependencies": {
    "turbo": "^2.4.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Write turbo.json**

Create `/Users/nelson/projects/vaultproof-open/turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {}
  }
}
```

---

### Task 7: Fix sdk and cli to use workspace dependency

The SDK and CLI currently reference `@vaultproof/shamir: "1.0.0"` (npm version). In the new repo they should resolve from the workspace.

**Files:**
- Modify: `/Users/nelson/projects/vaultproof-open/packages/sdk/package.json`
- Modify: `/Users/nelson/projects/vaultproof-open/packages/cli/package.json`

**Step 1: Update sdk dependency**

In `/Users/nelson/projects/vaultproof-open/packages/sdk/package.json`, change:
```json
"@vaultproof/shamir": "1.0.0"
```
to:
```json
"@vaultproof/shamir": "*"
```

**Step 2: Update cli dependency**

Same change in `/Users/nelson/projects/vaultproof-open/packages/cli/package.json`.

---

### Task 8: Verify the build works

**Step 1: Install and build**

Run:
```bash
cd /Users/nelson/projects/vaultproof-open
npm install
npm run build
```
Expected: all four packages build without errors.

**Step 2: Run shamir tests**

Run:
```bash
cd /Users/nelson/projects/vaultproof-open
npm run test --workspace=packages/shamir
```
Expected: all shamir tests pass.

---

### Task 9: Add .gitignore and LICENSE

**Files:**
- Create: `/Users/nelson/projects/vaultproof-open/.gitignore`
- Create: `/Users/nelson/projects/vaultproof-open/LICENSE`

**Step 1: Write .gitignore**

Create `/Users/nelson/projects/vaultproof-open/.gitignore`:
```
node_modules/
dist/
target/
*.env
.env*
*.pem
*.crx
.turbo/
```

**Step 2: Write LICENSE**

Create `/Users/nelson/projects/vaultproof-open/LICENSE`:
```
MIT License

Copyright (c) 2026 VaultProof

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### Task 10: Write README

**Files:**
- Create: `/Users/nelson/projects/vaultproof-open/README.md`

**Step 1: Write README**

Create `/Users/nelson/projects/vaultproof-open/README.md`:
```markdown
# VaultProof — Open Source Core

**You don't need to trust our servers.**

Your API key is split into two shares in your browser before any network request is made. One share never leaves your device. Here's the code that does it.

[vaultproof.dev](https://vaultproof.dev) · [Docs](https://vaultproof.dev/docs) · [Dashboard](https://vaultproof.dev/app)

---

## What's in this repo

This repo contains the four packages that run on your machine:

| Package | Description |
|---|---|
| [`packages/shamir`](./packages/shamir) | Shamir secret sharing over GF(256) — splits your key in the browser |
| [`packages/circuits`](./packages/circuits) | Noir zero-knowledge circuits — proves authorization without revealing your key |
| [`packages/sdk`](./packages/sdk) | `@vaultproof/sdk` — the client SDK |
| [`packages/cli`](./packages/cli) | `@vaultproof/cli` — the terminal client |

## What's not in this repo

The backend, proxy worker, and dashboard are closed source. But by design, you don't need to trust them:

- Your key is split into 2 shares **in your browser** using the Shamir code in this repo
- Share 1 is encrypted and stored in the vault
- **Share 2 never leaves your device**
- The vault can never reconstruct your key without your device sending Share 2

The backend never sees your full key. That's not a claim — it's enforced by the math in this repo.

## Packages

### `@vaultproof/shamir`

```bash
npm install @vaultproof/shamir
```

Shamir (2,2) secret splitting over GF(256). Used to split API keys in the browser before storage.

### `@vaultproof/sdk`

```bash
npm install @vaultproof/sdk
```

Store and retrieve API keys, make proxied LLM calls. See [docs](https://vaultproof.dev/docs).

### `@vaultproof/cli`

```bash
npm install -g @vaultproof/cli
vaultproof --help
```

### ZK Circuits

The `packages/circuits` directory contains the [Noir](https://noir-lang.org/) circuits used to generate zero-knowledge proofs for key authorization. Built with Noir >=0.36.0.

## Development

```bash
npm install
npm run build
npm run test
```

## License

MIT
```

---

### Task 11: Initial commit

**Step 1: Stage and commit**

Run:
```bash
cd /Users/nelson/projects/vaultproof-open
git add .
git commit -m "feat: initial open source release — shamir, circuits, sdk, cli"
```

---

### Task 12: Create GitHub repo and push

> **Note for Nelson:** You'll need to create the repo manually at github.com/new under the `vaultproof` org (or your personal account), set it to **public**, then run:

```bash
cd /Users/nelson/projects/vaultproof-open
git remote add origin https://github.com/vaultproof/vaultproof.git
git branch -M main
git push -u origin main
```

After pushing, add these repo settings on GitHub:
- Description: *"Open source core — Shamir splitting, ZK circuits, SDK, and CLI"*
- Website: `https://vaultproof.dev`
- Topics: `api-keys`, `zero-knowledge`, `shamir`, `security`, `typescript`
