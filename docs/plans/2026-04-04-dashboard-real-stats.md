# Dashboard Keys Page — Real Data Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all demo/hardcoded data in the keys dashboard with real API calls to show actual keys and usage stats.

**Architecture:** Add Supabase auth (same pattern as admin page) to get a JWT, then fetch real keys from `GET /api/v1/keys/list` and real per-key stats from `GET /api/v1/stats/by-key` in parallel. Merge stats into keys by ID for display.

**Tech Stack:** Next.js (app router), Supabase JS client, Tailwind CSS (existing)

---

### Task 1: Add Supabase auth + API client setup

**Files:**
- Modify: `apps/dashboard/src/app/keys/page.tsx:1-14` (imports and top-level constants)

**Step 1: Add imports, Supabase client, backend URL, and interfaces**

Replace the top of `keys/page.tsx` (lines 1–54) with:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dashboard-production-b76c.up.railway.app";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

interface AppGrant {
  id: string;
  app_id: string;
  app_name: string;
  granted_at: string;
}

interface KeySlot {
  id: string;
  provider: string;
  label: string;
  status: string;
  created_at: string;
  app_grants: AppGrant[];
}

interface KeyStats {
  id: string;
  dailyUsed: number;
  callsThisMonth: number;
  errorsThisMonth: number;
  lastUsed: string | null;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-green-500/10 text-green-400 border-green-500/20",
  anthropic: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  google: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  together: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};
```

**Step 2: Verify the file still compiles**

Run: `cd apps/dashboard && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds (page is "use client", so partial is fine)

**Step 3: Commit**

```bash
git add apps/dashboard/src/app/keys/page.tsx
git commit -m "refactor(dashboard): replace demo interfaces with real API types for keys page"
```

---

### Task 2: Add auth + data fetching logic

**Files:**
- Modify: `apps/dashboard/src/app/keys/page.tsx` (component body)

**Step 1: Replace the component state and add fetch logic**

Replace `export default function KeysDashboard()` opening through the return statement with:

```tsx
export default function KeysDashboard() {
  const [keys, setKeys] = useState<KeySlot[]>([]);
  const [stats, setStats] = useState<Record<string, KeyStats>>({});
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddKey, setShowAddKey] = useState(false);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setToken(data.session.access_token);
      } else {
        setError("Not logged in. Sign in at vaultproof.dev first.");
        setLoading(false);
      }
    });
  }, []);

  // Fetch keys + stats
  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [keysRes, statsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/v1/keys/list`, { headers }),
        fetch(`${BACKEND_URL}/api/v1/stats/by-key`, { headers }),
      ]);

      if (!keysRes.ok || !statsRes.ok) {
        setError("Failed to fetch data. Try refreshing.");
        return;
      }

      const keysData = await keysRes.json();
      const statsData = await statsRes.json();

      setKeys(keysData.keySlots ?? []);

      const statsMap: Record<string, KeyStats> = {};
      for (const k of statsData.keys ?? []) {
        statsMap[k.id] = k;
      }
      setStats(statsMap);
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  function timeAgo(iso: string | null): string {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
```

**Step 2: Verify the file compiles**

Run: `cd apps/dashboard && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/dashboard/src/app/keys/page.tsx
git commit -m "feat(dashboard): add real auth + API data fetching to keys page"
```

---

### Task 3: Update the JSX to use real data with loading/error/empty states

**Files:**
- Modify: `apps/dashboard/src/app/keys/page.tsx` (return JSX)

**Step 1: Add loading and error states at the top of the return block**

Right after the `<nav>` closing tag and the `<div className="max-w-4xl mx-auto px-6 py-8">` opening, before the Header section, add:

```tsx
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500">Loading your keys...</div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-red-400">{error}</div>
          </div>
        )}
```

Wrap the rest of the page content (Header through Security footer) in `{!loading && !error && ( ... )}`.

**Step 2: Update the header key count**

Change line with `{keys.length} key{keys.length !== 1 ? "s" : ""}` — this already works since `keys` is now real state.

**Step 3: Add empty state inside the keys list section**

After the `{/* Keys list */}` comment, before the `.map()`, add:

```tsx
          {keys.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
              <div className="text-gray-500 mb-2">No keys stored yet</div>
              <button
                onClick={() => setShowAddKey(true)}
                className="text-indigo-400 hover:text-indigo-300 text-sm transition"
              >
                Store your first API key
              </button>
            </div>
          )}
```

**Step 4: Update the per-key stats section**

Replace the Usage stats grid (the `{/* Usage stats */}` section with `Math.random()`) with:

```tsx
              {/* Usage stats */}
              <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Calls (24h)</div>
                  <div className="text-lg font-bold text-white">
                    {stats[key.id]?.dailyUsed ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Last Used</div>
                  <div className="text-sm text-gray-300">
                    {timeAgo(stats[key.id]?.lastUsed ?? null)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Errors (month)</div>
                  <div className="text-sm">
                    {(stats[key.id]?.errorsThisMonth ?? 0) === 0 ? (
                      <span className="text-green-400">All verified</span>
                    ) : (
                      <span className="text-red-400">{stats[key.id]?.errorsThisMonth} errors</span>
                    )}
                  </div>
                </div>
              </div>
```

**Step 5: Update the Connected Apps display to use real field names**

The app grants from the API use `app_name` and `granted_at` (snake_case), not `appName` and `grantedAt`. Update the map:

```tsx
                    {key.app_grants.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <span className="text-gray-300">{grant.app_name}</span>
                        <button className="text-gray-600 hover:text-red-400 transition">
                          &#10005;
                        </button>
                      </div>
                    ))}
```

Also update the "Connected apps" count to use `key.app_grants.length` and the created date to use `key.created_at`:

```tsx
                    <div className="text-xs text-gray-500 mt-0.5">
                      Created {new Date(key.created_at).toLocaleDateString()} &middot;{" "}
                      {key.app_grants.length} app{key.app_grants.length !== 1 ? "s" : ""} connected
                    </div>
```

And the conditional: `{key.app_grants.length > 0 && (`

**Step 6: Verify build**

Run: `cd apps/dashboard && npx next build --no-lint 2>&1 | tail -10`
Expected: Build succeeds with no errors

**Step 7: Commit**

```bash
git add apps/dashboard/src/app/keys/page.tsx
git commit -m "feat(dashboard): wire keys page to real API data, remove all demo data"
```

---

### Task 4: Verify end-to-end

**Step 1: Run dev server and check in browser**

Run: `cd apps/dashboard && npx next dev`

Check:
- `/keys` shows loading state briefly
- If not logged in, shows "Not logged in" message
- If logged in, shows real keys from API
- Stats show real numbers (not random)
- Empty state works if no keys

**Step 2: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "fix(dashboard): cleanup after real stats integration"
```
