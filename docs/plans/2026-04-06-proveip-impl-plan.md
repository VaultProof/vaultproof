# ProveIP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a ZK-powered IP ownership proof platform where startups can prove properties about their intellectual property without revealing it.

**Architecture:** Next.js 15 app with Supabase (auth + DB + storage), CF Workers API (Hono), Noir ZK circuits for proof generation, Base L2 for Merkle root anchoring. Client-side file hashing — raw files never touch the server.

**Tech Stack:** Next.js 15, React 19, Tailwind 4, shadcn/ui, Supabase, Cloudflare Workers, Hono, Noir (Aztec), ethers.js (Base L2), Stripe

---

## Phase 1: Project Scaffolding

### Task 1: Initialize the repo

**Files:**
- Create: `proveip/package.json`
- Create: `proveip/tsconfig.json`
- Create: `proveip/.gitignore`
- Create: `proveip/README.md`

**Step 1: Create repo and init**

```bash
cd /Users/nelson/projects
mkdir proveip && cd proveip
git init
```

**Step 2: Create package.json**

```json
{
  "name": "proveip",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.7.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

**Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "persistent": true, "cache": false },
    "test": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

**Step 4: Create .gitignore**

```
node_modules
.next
dist
.env
.env.local
.wrangler
.turbo
```

**Step 5: Install dependencies**

```bash
npm install
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: init monorepo with turborepo"
```

---

### Task 2: Scaffold Next.js frontend

**Files:**
- Create: `apps/web/` (Next.js app)

**Step 1: Create Next.js app**

```bash
cd /Users/nelson/projects/proveip
npx create-next-app@latest apps/web \
  --typescript --tailwind --eslint --app \
  --src-dir --import-alias "@/*" --no-turbopack
```

**Step 2: Install shadcn/ui**

```bash
cd apps/web
npx shadcn@latest init -d
npx shadcn@latest add button card dialog input label tabs badge separator alert toast dropdown-menu avatar
```

**Step 3: Verify dev server**

```bash
npm run dev
```

Expected: Next.js running on localhost:3000

**Step 4: Commit**

```bash
cd /Users/nelson/projects/proveip
git add -A
git commit -m "feat: scaffold next.js frontend with shadcn/ui"
```

---

### Task 3: Set up Supabase

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/src/client.ts`
- Create: `supabase/migrations/00001_initial_schema.sql`

**Step 1: Init Supabase project**

Create a new Supabase project called "proveip" via the Supabase dashboard.

**Step 2: Create the initial schema migration**

```sql
-- supabase/migrations/00001_initial_schema.sql

-- Proofs table
create table public.proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_hash text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text,
  claim_type text not null default 'existence',
  noir_proof bytea,
  merkle_leaf text,
  merkle_index integer,
  status text not null default 'pending' check (status in ('pending', 'proving', 'proved', 'anchored', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Claims table
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.proofs(id) on delete cascade,
  claim_type text not null check (claim_type in ('existence', 'authorship', 'similarity', 'performance', 'containment')),
  claim_params jsonb not null default '{}',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Anchors table (Merkle root → Base L2)
create table public.anchors (
  id uuid primary key default gen_random_uuid(),
  merkle_root text not null,
  chain_tx_hash text,
  anchor_date date not null default current_date,
  proof_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'anchored', 'failed')),
  created_at timestamptz not null default now()
);

-- Disputes table
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  claimant_a uuid not null references auth.users(id),
  claimant_b uuid references auth.users(id),
  proof_a_id uuid not null references public.proofs(id),
  proof_b_id uuid references public.proofs(id),
  invite_code text unique,
  verdict jsonb,
  status text not null default 'open' check (status in ('open', 'pending_response', 'verifying', 'resolved', 'dismissed')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Certificates table
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.proofs(id) on delete cascade,
  public_url text,
  public_id text unique not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS policies
alter table public.proofs enable row level security;
alter table public.claims enable row level security;
alter table public.disputes enable row level security;
alter table public.certificates enable row level security;
alter table public.anchors enable row level security;

-- Users can only see their own proofs
create policy "Users can view own proofs" on public.proofs
  for select using (auth.uid() = user_id);
create policy "Users can insert own proofs" on public.proofs
  for insert with check (auth.uid() = user_id);

-- Users can see claims on their own proofs
create policy "Users can view own claims" on public.claims
  for select using (
    exists (select 1 from public.proofs where proofs.id = claims.proof_id and proofs.user_id = auth.uid())
  );
create policy "Users can insert own claims" on public.claims
  for insert with check (
    exists (select 1 from public.proofs where proofs.id = claims.proof_id and proofs.user_id = auth.uid())
  );

-- Users can see disputes they're involved in
create policy "Users can view own disputes" on public.disputes
  for select using (auth.uid() = claimant_a or auth.uid() = claimant_b);
create policy "Users can create disputes" on public.disputes
  for insert with check (auth.uid() = claimant_a);

-- Certificates are publicly readable by public_id (handled via API)
create policy "Users can view own certificates" on public.certificates
  for select using (
    exists (select 1 from public.proofs where proofs.id = certificates.proof_id and proofs.user_id = auth.uid())
  );

-- Anchors are readable by all authenticated users
create policy "Authenticated users can view anchors" on public.anchors
  for select using (auth.role() = 'authenticated');

-- Indexes
create index idx_proofs_user_id on public.proofs(user_id);
create index idx_proofs_file_hash on public.proofs(file_hash);
create index idx_proofs_status on public.proofs(status);
create index idx_claims_proof_id on public.claims(proof_id);
create index idx_disputes_claimant_a on public.disputes(claimant_a);
create index idx_disputes_claimant_b on public.disputes(claimant_b);
create index idx_certificates_public_id on public.certificates(public_id);
create index idx_anchors_date on public.anchors(anchor_date);
```

**Step 3: Create DB client package**

```typescript
// packages/db/src/client.ts
import { createClient } from '@supabase/supabase-js';

export function createSupabaseClient(url: string, anonKey: string) {
  return createClient(url, anonKey);
}

export function createSupabaseAdmin(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
```

```json
// packages/db/package.json
{
  "name": "@proveip/db",
  "version": "0.1.0",
  "private": true,
  "main": "src/client.ts",
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0"
  }
}
```

**Step 4: Run migration against Supabase**

```bash
npx supabase db push
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add supabase schema with proofs, claims, disputes, certificates, anchors"
```

---

### Task 4: Set up CF Worker API

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/src/index.ts`
- Create: `packages/api/wrangler.toml`

**Step 1: Create the API package**

```json
// packages/api/package.json
{
  "name": "@proveip/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "@supabase/supabase-js": "^2.49.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "vitest": "^3.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create wrangler.toml**

```toml
# packages/api/wrangler.toml
name = "proveip-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
ENVIRONMENT = "production"

[env.staging]
name = "proveip-api-staging"
vars = { ENVIRONMENT = "staging" }
```

**Step 3: Create the Hono API skeleton**

```typescript
// packages/api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({
  origin: ['http://localhost:3000', 'https://proveip.com'],
  credentials: true,
}));

app.get('/health', (c) => c.json({ status: 'ok', env: c.env.ENVIRONMENT }));

// Proof routes
app.post('/api/proofs', async (c) => {
  return c.json({ message: 'TODO: create proof' }, 501);
});

app.get('/api/proofs', async (c) => {
  return c.json({ message: 'TODO: list proofs' }, 501);
});

app.get('/api/proofs/:id', async (c) => {
  return c.json({ message: 'TODO: get proof' }, 501);
});

// Certificate routes
app.get('/api/certificates/:publicId', async (c) => {
  return c.json({ message: 'TODO: get certificate' }, 501);
});

// Dispute routes
app.post('/api/disputes', async (c) => {
  return c.json({ message: 'TODO: create dispute' }, 501);
});

app.get('/api/disputes', async (c) => {
  return c.json({ message: 'TODO: list disputes' }, 501);
});

// Anchor routes (internal/cron)
app.post('/api/anchors/batch', async (c) => {
  return c.json({ message: 'TODO: batch anchor' }, 501);
});

export default app;
```

**Step 4: Verify worker runs**

```bash
cd packages/api
npx wrangler dev
```

Expected: Worker running on localhost:8787, GET /health returns `{"status":"ok"}`

**Step 5: Commit**

```bash
cd /Users/nelson/projects/proveip
git add -A
git commit -m "feat: scaffold cf worker api with hono"
```

---

## Phase 2: Core — Client-Side Hashing & Proof Creation

### Task 5: Client-side file hashing library

**Files:**
- Create: `packages/hash/package.json`
- Create: `packages/hash/src/index.ts`
- Create: `packages/hash/src/__tests__/hash.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/hash/src/__tests__/hash.test.ts
import { describe, it, expect } from 'vitest';
import { hashFile, hashBuffer } from '../index';

describe('hashBuffer', () => {
  it('should return consistent SHA-256 hex digest', async () => {
    const data = new TextEncoder().encode('hello world');
    const hash = await hashBuffer(data.buffer as ArrayBuffer);
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('should return different hashes for different inputs', async () => {
    const a = await hashBuffer(new TextEncoder().encode('a').buffer as ArrayBuffer);
    const b = await hashBuffer(new TextEncoder().encode('b').buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/hash
npx vitest run
```

Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/hash/src/index.ts
export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashFile(file: File): Promise<{ hash: string; size: number; name: string; type: string }> {
  const buffer = await file.arrayBuffer();
  const hash = await hashBuffer(buffer);
  return { hash, size: file.size, name: file.name, type: file.type };
}
```

```json
// packages/hash/package.json
{
  "name": "@proveip/hash",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^3.0.0", "typescript": "^5.7.0" }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run
```

Expected: 2 tests PASS

**Step 5: Commit**

```bash
cd /Users/nelson/projects/proveip
git add -A
git commit -m "feat: add client-side sha-256 hashing library"
```

---

### Task 6: Noir ZK circuit — existence + authorship proof

**Files:**
- Create: `packages/circuits/Nargo.toml`
- Create: `packages/circuits/src/main.nr`

**Step 1: Init Noir project**

```bash
cd /Users/nelson/projects/proveip/packages
mkdir circuits && cd circuits
nargo init --name proveip_proof
```

**Step 2: Write the existence + authorship circuit**

```noir
// packages/circuits/src/main.nr

// ProveIP: Proves that a user owned a file at a specific timestamp
// without revealing the file contents.
//
// Public inputs (visible to verifier):
//   - file_hash: SHA-256 hash of the file (32 bytes)
//   - timestamp: Unix timestamp of proof creation
//   - identity_commitment: Hash of user identity
//
// Private inputs (hidden):
//   - user_id: The actual user identifier
//   - user_secret: A secret known only to the user
//   - file_metadata: Additional file info (size, type hash)

use std::hash::sha256;

fn main(
    // Public inputs
    file_hash: pub [u8; 32],
    timestamp: pub u64,
    identity_commitment: pub [u8; 32],
    // Private inputs
    user_id: [u8; 32],
    user_secret: [u8; 32],
    file_metadata: [u8; 32]
) {
    // 1. Verify the identity commitment matches the user
    let mut identity_preimage: [u8; 64] = [0; 64];
    for i in 0..32 {
        identity_preimage[i] = user_id[i];
        identity_preimage[i + 32] = user_secret[i];
    }
    let computed_identity = sha256(identity_preimage);
    assert(computed_identity == identity_commitment, "Identity commitment mismatch");

    // 2. Verify file hash is non-zero (file exists)
    let mut hash_nonzero = false;
    for i in 0..32 {
        if file_hash[i] != 0 {
            hash_nonzero = true;
        }
    }
    assert(hash_nonzero, "File hash cannot be zero");

    // 3. Verify timestamp is reasonable (after 2024-01-01)
    assert(timestamp > 1704067200, "Timestamp must be after 2024-01-01");

    // 4. Bind file metadata to the proof (ensures metadata wasn't tampered)
    let mut metadata_nonzero = false;
    for i in 0..32 {
        if file_metadata[i] != 0 {
            metadata_nonzero = true;
        }
    }
    assert(metadata_nonzero, "File metadata cannot be zero");
}
```

**Step 3: Compile the circuit**

```bash
nargo compile
```

Expected: Circuit compiles successfully

**Step 4: Write a test in Noir**

```noir
// Add to bottom of main.nr or in a separate test file

#[test]
fn test_valid_proof() {
    let user_id = [1; 32];
    let user_secret = [2; 32];
    let mut identity_preimage: [u8; 64] = [0; 64];
    for i in 0..32 {
        identity_preimage[i] = user_id[i];
        identity_preimage[i + 32] = user_secret[i];
    }
    let identity_commitment = std::hash::sha256(identity_preimage);
    let file_hash = [3; 32];
    let file_metadata = [4; 32];
    let timestamp: u64 = 1712000000; // April 2024

    main(file_hash, timestamp, identity_commitment, user_id, user_secret, file_metadata);
}
```

**Step 5: Run Noir tests**

```bash
nargo test
```

Expected: 1 test PASS

**Step 6: Commit**

```bash
cd /Users/nelson/projects/proveip
git add -A
git commit -m "feat: add noir circuit for existence + authorship proof"
```

---

### Task 7: ZK proof generation service

**Files:**
- Create: `packages/prover/package.json`
- Create: `packages/prover/src/index.ts`
- Create: `packages/prover/src/__tests__/prover.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/prover/src/__tests__/prover.test.ts
import { describe, it, expect } from 'vitest';
import { generateProof, verifyProof } from '../index';

describe('generateProof', () => {
  it('should generate a valid proof for a file hash', async () => {
    const input = {
      fileHash: new Uint8Array(32).fill(3),
      timestamp: BigInt(1712000000),
      userId: new Uint8Array(32).fill(1),
      userSecret: new Uint8Array(32).fill(2),
      fileMetadata: new Uint8Array(32).fill(4),
    };

    const result = await generateProof(input);
    expect(result.proof).toBeDefined();
    expect(result.publicInputs).toBeDefined();
    expect(result.publicInputs.fileHash).toEqual(input.fileHash);
    expect(result.publicInputs.timestamp).toBe(input.timestamp);
  }, 60000); // ZK proof gen can take a while

  it('should verify a valid proof', async () => {
    const input = {
      fileHash: new Uint8Array(32).fill(3),
      timestamp: BigInt(1712000000),
      userId: new Uint8Array(32).fill(1),
      userSecret: new Uint8Array(32).fill(2),
      fileMetadata: new Uint8Array(32).fill(4),
    };

    const result = await generateProof(input);
    const valid = await verifyProof(result.proof, result.publicInputs);
    expect(valid).toBe(true);
  }, 60000);
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/prover
npx vitest run
```

Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/prover/src/index.ts
import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import circuit from '../../circuits/target/proveip_proof.json';

export interface ProofInput {
  fileHash: Uint8Array;
  timestamp: bigint;
  userId: Uint8Array;
  userSecret: Uint8Array;
  fileMetadata: Uint8Array;
}

export interface ProofResult {
  proof: Uint8Array;
  publicInputs: {
    fileHash: Uint8Array;
    timestamp: bigint;
    identityCommitment: Uint8Array;
  };
}

export async function generateIdentityCommitment(
  userId: Uint8Array,
  userSecret: Uint8Array
): Promise<Uint8Array> {
  const preimage = new Uint8Array(64);
  preimage.set(userId, 0);
  preimage.set(userSecret, 32);
  const hash = await crypto.subtle.digest('SHA-256', preimage);
  return new Uint8Array(hash);
}

export async function generateProof(input: ProofInput): Promise<ProofResult> {
  const backend = new BarretenbergBackend(circuit as any);
  const noir = new Noir(circuit as any);

  const identityCommitment = await generateIdentityCommitment(input.userId, input.userSecret);

  const witnessInput = {
    file_hash: Array.from(input.fileHash),
    timestamp: input.timestamp.toString(),
    identity_commitment: Array.from(identityCommitment),
    user_id: Array.from(input.userId),
    user_secret: Array.from(input.userSecret),
    file_metadata: Array.from(input.fileMetadata),
  };

  const { witness } = await noir.execute(witnessInput);
  const proof = await backend.generateProof(witness);

  return {
    proof: proof.proof,
    publicInputs: {
      fileHash: input.fileHash,
      timestamp: input.timestamp,
      identityCommitment,
    },
  };
}

export async function verifyProof(
  proof: Uint8Array,
  publicInputs: ProofResult['publicInputs']
): Promise<boolean> {
  const backend = new BarretenbergBackend(circuit as any);
  const result = await backend.verifyProof({
    proof,
    publicInputs: [
      ...Array.from(publicInputs.fileHash),
      publicInputs.timestamp.toString(),
      ...Array.from(publicInputs.identityCommitment),
    ],
  });
  return result;
}
```

```json
// packages/prover/package.json
{
  "name": "@proveip/prover",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@noir-lang/noir_js": "^1.0.0-beta",
    "@noir-lang/backend_barretenberg": "^1.0.0-beta"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run
```

Expected: 2 tests PASS

**Step 5: Commit**

```bash
cd /Users/nelson/projects/proveip
git add -A
git commit -m "feat: add zk proof generation and verification service"
```

---

## Phase 3: API Endpoints

### Task 8: Auth middleware

**Files:**
- Modify: `packages/api/src/index.ts`
- Create: `packages/api/src/middleware/auth.ts`

**Step 1: Write auth middleware**

```typescript
// packages/api/src/middleware/auth.ts
import { Context, Next } from 'hono';
import { createClient } from '@supabase/supabase-js';

export async function requireAuth(c: Context, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return c.json({ error: 'Missing authorization token' }, 401);
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('user', user);
  c.set('userId', user.id);
  await next();
}
```

**Step 2: Wire into API**

Add `import { requireAuth } from './middleware/auth';` to index.ts and apply to protected routes:

```typescript
app.use('/api/proofs/*', requireAuth);
app.use('/api/disputes/*', requireAuth);
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add supabase auth middleware"
```

---

### Task 9: POST /api/proofs — Create a proof

**Files:**
- Create: `packages/api/src/routes/proofs.ts`
- Create: `packages/api/src/__tests__/proofs.test.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/api/src/__tests__/proofs.test.ts
import { describe, it, expect } from 'vitest';

describe('POST /api/proofs', () => {
  it('should reject requests without auth', async () => {
    const res = await fetch('http://localhost:8787/api/proofs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileHash: 'abc', fileName: 'test.txt', fileSize: 100 }),
    });
    expect(res.status).toBe(401);
  });

  it('should reject requests with missing fileHash', async () => {
    const res = await fetch('http://localhost:8787/api/proofs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
      },
      body: JSON.stringify({ fileName: 'test.txt' }),
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Write implementation**

```typescript
// packages/api/src/routes/proofs.ts
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';

const proofs = new Hono();

proofs.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const { fileHash, fileName, fileSize, mimeType, claimType } = body;

  if (!fileHash || !fileName || !fileSize) {
    return c.json({ error: 'Missing required fields: fileHash, fileName, fileSize' }, 400);
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  const { data: proof, error } = await supabase
    .from('proofs')
    .insert({
      user_id: userId,
      file_hash: fileHash,
      file_name: fileName,
      file_size: fileSize,
      mime_type: mimeType || null,
      claim_type: claimType || 'existence',
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: 'Failed to create proof' }, 500);
  }

  // Create the default claim
  await supabase.from('claims').insert({
    proof_id: proof.id,
    claim_type: claimType || 'existence',
    claim_params: { file_hash: fileHash, timestamp: Date.now() },
  });

  return c.json({ proof }, 201);
});

proofs.get('/', async (c) => {
  const userId = c.get('userId');
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  const { data: proofList, error } = await supabase
    .from('proofs')
    .select('*, claims(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return c.json({ error: 'Failed to fetch proofs' }, 500);
  }

  return c.json({ proofs: proofList });
});

proofs.get('/:id', async (c) => {
  const userId = c.get('userId');
  const proofId = c.req.param('id');
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  const { data: proof, error } = await supabase
    .from('proofs')
    .select('*, claims(*), certificates(*)')
    .eq('id', proofId)
    .eq('user_id', userId)
    .single();

  if (error || !proof) {
    return c.json({ error: 'Proof not found' }, 404);
  }

  return c.json({ proof });
});

export { proofs };
```

**Step 3: Wire routes into main app**

```typescript
// In packages/api/src/index.ts, add:
import { proofs } from './routes/proofs';
app.route('/api/proofs', proofs);
```

**Step 4: Run tests**

```bash
npx vitest run
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add proof CRUD endpoints"
```

---

### Task 10: Certificate generation + public verification endpoint

**Files:**
- Create: `packages/api/src/routes/certificates.ts`

**Step 1: Write implementation**

```typescript
// packages/api/src/routes/certificates.ts
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

const certificates = new Hono();

// Create certificate for a proof (authenticated)
certificates.post('/', async (c) => {
  const userId = c.get('userId');
  const { proofId, expiresInDays } = await c.req.json();

  if (!proofId) {
    return c.json({ error: 'Missing proofId' }, 400);
  }

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  // Verify proof belongs to user
  const { data: proof } = await supabase
    .from('proofs')
    .select('id, status')
    .eq('id', proofId)
    .eq('user_id', userId)
    .single();

  if (!proof) {
    return c.json({ error: 'Proof not found' }, 404);
  }

  const publicId = nanoid(12);
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
    : null;

  const { data: cert, error } = await supabase
    .from('certificates')
    .insert({
      proof_id: proofId,
      public_id: publicId,
      public_url: `https://proveip.com/verify/${publicId}`,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: 'Failed to create certificate' }, 500);
  }

  return c.json({ certificate: cert }, 201);
});

export { certificates };

// Public verification endpoint (no auth required)
export const publicVerify = new Hono();

publicVerify.get('/:publicId', async (c) => {
  const publicId = c.req.param('publicId');
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

  const { data: cert } = await supabase
    .from('certificates')
    .select('*, proof:proofs(file_hash, file_name, claim_type, status, created_at, claims(claim_type, claim_params, verified_at))')
    .eq('public_id', publicId)
    .single();

  if (!cert) {
    return c.json({ error: 'Certificate not found' }, 404);
  }

  if (cert.expires_at && new Date(cert.expires_at) < new Date()) {
    return c.json({ error: 'Certificate expired' }, 410);
  }

  return c.json({
    verified: true,
    certificate: {
      publicId: cert.public_id,
      fileHash: cert.proof.file_hash,
      fileName: cert.proof.file_name,
      claimType: cert.proof.claim_type,
      proofStatus: cert.proof.status,
      claims: cert.proof.claims,
      createdAt: cert.proof.created_at,
      expiresAt: cert.expires_at,
    },
  });
});
```

**Step 2: Wire into main app**

```typescript
import { certificates, publicVerify } from './routes/certificates';
app.route('/api/certificates', certificates); // authenticated
app.route('/api/verify', publicVerify); // public
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add certificate generation and public verification endpoint"
```

---

## Phase 4: Frontend — Upload & Prove UI

### Task 11: Auth pages (login/signup)

**Files:**
- Create: `apps/web/src/lib/supabase.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/signup/page.tsx`

**Step 1: Supabase client**

```typescript
// apps/web/src/lib/supabase.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**Step 2: Build login page with email/password + GitHub OAuth**

Standard Supabase auth form using shadcn/ui Card, Input, Button, Label components. Include both email/password and GitHub OAuth options.

**Step 3: Build signup page**

Same pattern as login, with email confirmation flow.

**Step 4: Add auth callback route**

```typescript
// apps/web/src/app/auth/callback/route.ts
import { createClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add auth pages with supabase login/signup"
```

---

### Task 12: Dashboard layout + proof list

**Files:**
- Create: `apps/web/src/app/dashboard/page.tsx`
- Create: `apps/web/src/app/dashboard/layout.tsx`
- Create: `apps/web/src/components/proof-card.tsx`

**Step 1: Build dashboard layout**

Sidebar nav with: Dashboard, My Proofs, Disputes, Settings. Top bar with user avatar and logout.

**Step 2: Build proof list page**

Fetch proofs from API, display as cards showing:
- File name + icon based on type
- Claim type badge (existence, authorship)
- Status badge (pending, proved, anchored)
- Timestamp
- "View Certificate" button

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add dashboard layout and proof list"
```

---

### Task 13: Upload & prove flow

**Files:**
- Create: `apps/web/src/app/dashboard/new/page.tsx`
- Create: `apps/web/src/components/file-uploader.tsx`
- Create: `apps/web/src/components/claim-selector.tsx`

**Step 1: Build file uploader component**

- Drag-and-drop zone using shadcn Card
- On file drop: hash client-side using `@proveip/hash`
- Show file name, size, hash preview
- File NEVER uploaded to server — only the hash

**Step 2: Build claim selector**

- Radio group: "Existence" (I had this file at this time) or "Authorship" (I created this)
- For authorship: identity is auto-linked from Supabase auth

**Step 3: Build the prove flow**

```
1. Drop file → client-side hash
2. Select claim type
3. Click "Create Proof"
4. POST /api/proofs with { fileHash, fileName, fileSize, mimeType, claimType }
5. Show success + link to generate certificate
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add upload and prove flow with client-side hashing"
```

---

### Task 14: Certificate view + share page

**Files:**
- Create: `apps/web/src/app/verify/[publicId]/page.tsx`
- Create: `apps/web/src/app/dashboard/proofs/[id]/page.tsx`

**Step 1: Build proof detail page (authenticated)**

Shows full proof details + button to generate certificate. If certificate exists, show shareable link and "Copy Link" button.

**Step 2: Build public verification page (unauthenticated)**

- Fetches from `GET /api/verify/:publicId`
- Clean, minimal page showing: file name, claim type, timestamp, proof status, anchor status
- Green checkmark if verified, red X if expired
- "This proof is anchored on Base L2" with tx link if anchored

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add certificate view and public verification page"
```

---

## Phase 5: Merkle Anchoring

### Task 15: Merkle tree + Base L2 anchoring

**Files:**
- Create: `packages/anchor/package.json`
- Create: `packages/anchor/src/merkle.ts`
- Create: `packages/anchor/src/anchor.ts`
- Create: `packages/anchor/src/__tests__/merkle.test.ts`

**Step 1: Write failing test for Merkle tree**

```typescript
// packages/anchor/src/__tests__/merkle.test.ts
import { describe, it, expect } from 'vitest';
import { MerkleTree } from '../merkle';

describe('MerkleTree', () => {
  it('should compute a root from leaves', () => {
    const leaves = ['leaf1', 'leaf2', 'leaf3'];
    const tree = new MerkleTree(leaves);
    expect(tree.root).toBeDefined();
    expect(tree.root.length).toBe(64); // hex sha256
  });

  it('should generate valid inclusion proofs', () => {
    const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(1);
    expect(MerkleTree.verify(proof, 'leaf2', tree.root)).toBe(true);
  });

  it('should reject invalid inclusion proofs', () => {
    const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(1);
    expect(MerkleTree.verify(proof, 'fake', tree.root)).toBe(false);
  });
});
```

**Step 2: Implement Merkle tree**

Simple binary Merkle tree with SHA-256 hashing. Include `getProof()` for inclusion proofs and static `verify()`.

**Step 3: Implement Base L2 anchoring**

```typescript
// packages/anchor/src/anchor.ts
import { ethers } from 'ethers';

const ANCHOR_ABI = [
  'function anchor(bytes32 merkleRoot) external',
  'event Anchored(bytes32 indexed merkleRoot, uint256 timestamp)',
];

export async function anchorMerkleRoot(
  merkleRoot: string,
  contractAddress: string,
  privateKey: string,
  rpcUrl: string
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, ANCHOR_ABI, wallet);

  const tx = await contract.anchor(`0x${merkleRoot}`);
  const receipt = await tx.wait();
  return receipt.hash;
}
```

**Step 4: Run tests**

```bash
npx vitest run
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add merkle tree and base l2 anchoring"
```

---

### Task 16: Daily anchor cron job

**Files:**
- Create: `packages/api/src/routes/anchors.ts`
- Modify: `packages/api/wrangler.toml` (add cron trigger)

**Step 1: Add cron trigger to wrangler.toml**

```toml
[triggers]
crons = ["0 0 * * *"]  # Daily at midnight UTC
```

**Step 2: Implement batch anchor endpoint**

- Fetch all proofs with status = 'proved' that haven't been anchored
- Build Merkle tree from their file hashes
- Anchor root to Base L2
- Update proofs with merkle_leaf and status = 'anchored'
- Create anchor record with tx hash

**Step 3: Add scheduled handler to worker**

```typescript
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings) {
    // Trigger the batch anchor
    await batchAnchor(env);
  },
};
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add daily merkle root anchoring cron"
```

---

## Phase 6: Dispute Resolution

### Task 17: Dispute flow API

**Files:**
- Create: `packages/api/src/routes/disputes.ts`

**Step 1: Implement dispute endpoints**

- `POST /api/disputes` — Create a dispute, generates invite code for claimant B
- `POST /api/disputes/:id/respond` — Claimant B submits their proof
- `POST /api/disputes/:id/verify` — Triggers ZK verification comparing timestamps
- `GET /api/disputes/:id` — Get dispute status + verdict

**Step 2: Implement basic verdict logic**

For v1, verdict is timestamp-based: whoever has the earlier anchored proof wins. The ZK verifier confirms both proofs are valid without revealing file contents.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add dispute resolution api"
```

---

### Task 18: Dispute UI

**Files:**
- Create: `apps/web/src/app/dashboard/disputes/page.tsx`
- Create: `apps/web/src/app/dashboard/disputes/new/page.tsx`
- Create: `apps/web/src/app/dashboard/disputes/[id]/page.tsx`
- Create: `apps/web/src/app/dispute/[inviteCode]/page.tsx`

**Step 1: Build dispute list page**

Show active + resolved disputes with status badges.

**Step 2: Build "Start Dispute" flow**

- Select one of your proofs as evidence
- Generate invite link for the other party
- Share link → other party submits their proof

**Step 3: Build dispute detail page**

Timeline view: filed → response → verification → verdict. Show verdict certificate when resolved.

**Step 4: Build invite response page (semi-public)**

Other party lands here, creates account if needed, uploads their file + selects proof.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add dispute resolution ui"
```

---

## Phase 7: Payments + Landing Page

### Task 19: Stripe integration

**Files:**
- Create: `packages/api/src/routes/billing.ts`
- Create: `apps/web/src/app/dashboard/settings/billing/page.tsx`

**Step 1: Set up Stripe products**

- Free: 5 proofs/month
- Pro ($29/mo): unlimited proofs, team access, API
- Dispute fee: $99/case (one-time charge)

**Step 2: Implement billing endpoints**

- `POST /api/billing/checkout` — Create Stripe checkout session
- `POST /api/billing/webhook` — Handle subscription events
- `GET /api/billing/usage` — Current proof count vs limit

**Step 3: Add proof limit enforcement**

In `POST /api/proofs`, check user's plan and current month's proof count. Reject if over limit.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add stripe billing with free/pro plans"
```

---

### Task 20: Landing page

**Files:**
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/hero.tsx`
- Create: `apps/web/src/components/features.tsx`
- Create: `apps/web/src/components/pricing.tsx`

**Step 1: Build landing page sections**

- **Hero:** "Prove your IP. Reveal nothing." + CTA
- **Problem:** The 4 pain points from the design doc
- **How it works:** 3-step visual (Upload → Prove → Verify)
- **Features:** Programmable claims, dispute resolution, on-chain anchoring
- **Pricing:** Free / Pro / Dispute tiers
- **Footer:** Links, legal

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add landing page with hero, features, pricing"
```

---

## Phase 8: Deploy

### Task 21: Deploy infrastructure

**Step 1: Set up Cloudflare Pages for frontend**

```bash
cd apps/web
npx wrangler pages project create proveip
```

**Step 2: Deploy CF Worker API**

```bash
cd packages/api
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler deploy
```

**Step 3: Set up environment variables in Cloudflare Pages**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`

**Step 4: Deploy Base L2 anchor contract**

Deploy a minimal anchor contract to Base mainnet (or testnet for MVP).

**Step 5: Verify end-to-end flow**

1. Sign up → login
2. Upload a file → see hash
3. Create proof → see in dashboard
4. Generate certificate → share link
5. Open verification link → see verified proof

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: add deployment config"
```
