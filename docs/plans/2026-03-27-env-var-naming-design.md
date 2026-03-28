# Env Var Naming + CLI Dotenv Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users specify the exact env var name when storing a key, and auto-read VAULTPROOF_API_KEY from dotenv files.

**Architecture:** Add nullable `envVar` column to `key_slots`, accept it in the SDK store endpoint, prompt for it in the CLI store command, and prioritize it in `resolveEnvVar()`. Separately, `getApiKey()` falls back to reading dotenv files.

**Tech Stack:** Prisma (schema + migration), Fastify + Zod (backend), Commander.js (CLI)

---

### Task 1: Schema — add `envVar` to KeySlot

**Files:**
- Modify: `packages/backend/prisma/schema.prisma:63-86`

**Step 1: Add the column**

In the `KeySlot` model, add after line 68 (`label`):

```prisma
  envVar           String?     @map("env_var")     // exact env var name, e.g. "NEXT_PUBLIC_SUPABASE_URL"
```

**Step 2: Generate and run migration**

Run:
```bash
cd packages/backend && npx prisma migrate dev --name add-key-slot-env-var
```
Expected: Migration creates `env_var` nullable column on `key_slots` table.

**Step 3: Commit**

```bash
git add packages/backend/prisma/
git commit -m "schema: add envVar column to key_slots"
```

---

### Task 2: Backend — accept `envVar` in store, return in keys

**Files:**
- Modify: `packages/backend/src/routes/sdk.ts:69-79` (store Zod schema)
- Modify: `packages/backend/src/routes/sdk.ts:97-111` (store prisma.create)
- Modify: `packages/backend/src/routes/sdk.ts:125-131` (store response)
- Modify: `packages/backend/src/routes/sdk.ts:451-457` (keys select)

**Step 1: Write the failing test**

Add to `packages/backend/src/tests/sdk-routes.test.ts`, inside the existing `describe` block:

```typescript
  it('stores a key with envVar and returns it in list', async () => {
    const shares = splitString('sk-test-envvar-key-12345678', 2, 2);
    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        provider: 'supabase',
        label: 'url',
        share1: serializeShare(shares[0]),
        share2: serializeShare(shares[1]),
        envVar: 'NEXT_PUBLIC_SUPABASE_URL',
      },
    });

    assert.equal(storeRes.statusCode, 200);
    const storeData = storeRes.json();
    assert.equal(storeData.envVar, 'NEXT_PUBLIC_SUPABASE_URL');

    // Verify it comes back in the keys list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: sdkHeaders,
    });

    assert.equal(listRes.statusCode, 200);
    const found = listRes.json().keys.find((k: any) => k.id === storeData.keyId);
    assert.ok(found, 'Key should appear in list');
    assert.equal(found.envVar, 'NEXT_PUBLIC_SUPABASE_URL');
  });
```

**Step 2: Run test to verify it fails**

Run: `cd packages/backend && npm run build && node --test dist/tests/sdk-routes.test.js 2>&1 | grep -A2 "envVar"`
Expected: FAIL — `envVar` not in Zod schema, not stored, not returned.

**Step 3: Add `envVar` to the store Zod schema**

In `sdk.ts` line 69, add to the `z.object`:

```typescript
      envVar: z.string().max(100).optional(),
```

**Step 4: Store `envVar` in prisma.create**

In `sdk.ts` line 87, destructure `envVar`:

```typescript
    const { share1, share2, provider, label, expiresAt, dailyLimit, monthlyLimit, blockOnLimit, envVar } = parsed.data;
```

In `sdk.ts` line 97, add to the `prisma.keySlot.create` data object:

```typescript
        envVar: envVar || undefined,
```

**Step 5: Return `envVar` in the store response**

In `sdk.ts` line 125, add to the return object:

```typescript
      envVar: keySlot.envVar,
```

**Step 6: Return `envVar` in the keys list**

In `sdk.ts` line 455, add `envVar` to the select:

```typescript
      select: { id: true, provider: true, label: true, envVar: true, createdAt: true },
```

**Step 7: Run test to verify it passes**

Run: `cd packages/backend && npm run build && node --test dist/tests/sdk-routes.test.js`
Expected: All tests pass including the new envVar test.

**Step 8: Commit**

```bash
git add packages/backend/src/routes/sdk.ts packages/backend/src/tests/sdk-routes.test.ts
git commit -m "feat: accept and return envVar in SDK store/keys endpoints"
```

---

### Task 3: CLI — prompt for env var name during store

**Files:**
- Modify: `packages/cli/src/index.ts:549-632` (store command)

**Step 1: Add `--var` flag to store command**

After line 556, add:

```typescript
  .option("--var <envVar>", "Environment variable name (e.g. NEXT_PUBLIC_SUPABASE_URL)")
```

Update the action signature to include `var?: string`.

**Step 2: Add interactive prompt after API key entry**

After the API key validation (line 585) and before the spinner (line 587), add:

```typescript
    // Resolve default env var name using existing inference
    const defaultEnvVar = resolveEnvVar(
      { provider: opts.provider, label: opts.label ?? "" },
      [{ provider: opts.provider, label: opts.label ?? "" }]
    );

    let envVar: string | undefined = opts.var;
    if (!envVar && !opts.value) {
      // Interactive mode — prompt with smart default
      const answer = await prompt(`Env var name [${defaultEnvVar}]: `);
      envVar = answer || defaultEnvVar;
    } else if (!envVar) {
      // Non-interactive (--value passed) — use default
      envVar = defaultEnvVar;
    }
```

**Step 3: Send `envVar` in the API payload**

In the `apiRequest` body (line 600), add:

```typescript
        envVar,
```

**Step 4: Update success message**

After line 622, change the success output to show the env var:

```typescript
    spinner.succeed(
      chalk.green(
        `Key stored: ${truncatedId} (${data.provider}${data.label ? " / " + data.label : ""})`
      )
    );
    console.log(chalk.dim(`  Will export as ${chalk.reset(data.envVar || envVar || defaultEnvVar)}`));
```

**Step 5: Build and verify**

Run: `cd packages/cli && npm run build`
Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat: prompt for env var name during vaultproof store"
```

---

### Task 4: CLI — prioritize stored envVar in resolveEnvVar

**Files:**
- Modify: `packages/cli/src/index.ts:1112-1143` (resolveEnvVar function)

**Step 1: Update function signature**

Change the key type to include optional `envVar`:

```typescript
function resolveEnvVar(
  key: { provider: string; label: string; envVar?: string },
  allKeys: Array<{ provider: string; label: string }>,
  customVar?: string
): string {
  if (customVar) return customVar;

  // Stored envVar is the source of truth
  if (key.envVar) return key.envVar;

  // ... rest of existing logic unchanged
```

**Step 2: Build and verify**

Run: `cd packages/cli && npm run build`
Expected: Compiles. No runtime changes needed — the `env` and `exec` commands already pass key objects from `GET /api/v1/sdk/keys`, which now includes `envVar`.

**Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat: prioritize stored envVar in resolveEnvVar"
```

---

### Task 5: CLI — read VAULTPROOF_API_KEY from dotenv files

**Files:**
- Modify: `packages/cli/src/config.ts:62-64` (getApiKey function)

**Step 1: Write the implementation**

Replace `getApiKey()`:

```typescript
export function getApiKey(): string | undefined {
  // Environment variable always wins
  if (process.env.VAULTPROOF_API_KEY) return process.env.VAULTPROOF_API_KEY;

  // Fall back to dotenv files in cwd
  const dotenvFiles = ['.env', '.env.local', '.env.development', '.env.development.local'];
  for (const file of dotenvFiles) {
    const filePath = path.join(process.cwd(), file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const match = content.match(/^VAULTPROOF_API_KEY\s*=\s*["']?([^\s"'#]+)["']?/m);
        if (match) return match[1];
      }
    } catch {
      // Unreadable file — skip
    }
  }

  return undefined;
}
```

**Step 2: Build and verify**

Run: `cd packages/cli && npm run build`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add packages/cli/src/config.ts
git commit -m "feat: read VAULTPROOF_API_KEY from dotenv files"
```

---

### Task 6: Build + run all tests

**Step 1: Build backend**

Run: `cd packages/backend && npm run build`
Expected: Compiles.

**Step 2: Run backend tests**

Run: `cd packages/backend && npm test`
Expected: All existing tests pass + new envVar test passes.

**Step 3: Build CLI**

Run: `cd packages/cli && npm run build`
Expected: Compiles.

**Step 4: Final commit if needed**

```bash
git add -A && git status
```

Verify no uncommitted changes remain.
