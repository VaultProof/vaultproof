"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

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

export default function KeysDashboard() {
  const [keys, setKeys] = useState<KeySlot[]>([]);
  const [stats, setStats] = useState<Record<string, KeyStats>>({});
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddKey, setShowAddKey] = useState(false);

  // Auth
  useEffect(() => {
    if (!supabase) {
      setError("Dashboard auth is not configured.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setToken(data.session.access_token);
        setUserEmail(data.session.user?.email ?? null);
      } else {
        setError("Not logged in. Sign in at vaultproof.dev first.");
        setLoading(false);
      }
    }).catch(() => {
      setError("Unable to check login status. Try refreshing.");
      setLoading(false);
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

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto border-b border-gray-800">
        <Link href="/">
          <Image src="/logo2.png" alt="VaultProof" width={40} height={40} />
        </Link>
        <div className="flex items-center gap-4">
          {userEmail && (
            <>
              <span className="text-sm text-gray-500">{userEmail}</span>
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">
                {userEmail[0].toUpperCase()}
              </div>
            </>
          )}
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500">Loading your keys...</div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
            <div className="text-red-400 mb-2">{error}</div>
            {token && (
              <button onClick={fetchData} className="text-sm text-indigo-400 hover:text-indigo-300 transition">
                Retry
              </button>
            )}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold">Your Keys</h1>
                <p className="text-sm text-gray-500 mt-1">
                  {keys.length} key{keys.length !== 1 ? "s" : ""} stored &middot; All
                  Shamir-split &middot; Zero-knowledge authorized
                </p>
              </div>
              <button
                onClick={() => setShowAddKey(!showAddKey)}
                className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                + Add Key
              </button>
            </div>

            {/* Add key form (simplified — in production, uses ZKKeyConnect widget) */}
            {showAddKey && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-8">
                <h2 className="text-lg font-bold mb-4">Store a New API Key</h2>
                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Provider</label>
                    <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="google">Google AI</option>
                      <option value="together">Together.ai</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Label</label>
                    <input
                      type="text"
                      placeholder="e.g., Production"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">API Key</label>
                  <input
                    type="password"
                    placeholder="sk-proj-..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-600">
                    &#128273; Key will be Shamir-split in your browser. We never see the full key.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowAddKey(false)}
                      className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition"
                    >
                      Cancel
                    </button>
                    <button className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition">
                      Split & Store
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Empty state */}
            {keys.length === 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
                <div className="text-gray-500 mb-2">No keys stored yet</div>
                <button onClick={() => setShowAddKey(true)} className="text-indigo-400 hover:text-indigo-300 text-sm transition">
                  Store your first API key
                </button>
              </div>
            )}

            {/* Keys list */}
            <div className="space-y-4">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                          PROVIDER_COLORS[key.provider] || "bg-gray-500/10 text-gray-400 border-gray-500/20"
                        }`}
                      >
                        {key.provider}
                      </div>
                      <div>
                        <div className="font-semibold">{key.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Created {new Date(key.created_at).toLocaleDateString()} &middot;{" "}
                          {key.app_grants.length} app{key.app_grants.length !== 1 ? "s" : ""} connected
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                        {key.status}
                      </span>
                      <button className="text-gray-500 hover:text-red-400 text-xs transition ml-2">
                        Revoke
                      </button>
                    </div>
                  </div>

                  {/* Connected apps */}
                  {key.app_grants.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-800">
                      <div className="text-xs text-gray-500 mb-2">Connected Apps</div>
                      <div className="flex flex-wrap gap-2">
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
                        <button className="text-xs text-indigo-400 hover:text-indigo-300 px-3 py-1.5 transition">
                          + Grant Access
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Usage stats */}
                  <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-gray-500">Calls (24h)</div>
                      <div className="text-lg font-bold text-white">{stats[key.id]?.dailyUsed ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Last Used</div>
                      <div className="text-sm text-gray-300">{timeAgo(stats[key.id]?.lastUsed ?? null)}</div>
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
                </div>
              ))}
            </div>

            {/* Security footer */}
            <div className="mt-12 text-center">
              <div className="inline-flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-full px-4 py-2 text-xs text-gray-500">
                &#128273; Shamir split &middot; Zero-knowledge proofs &middot; Ephemeral reconstruction &middot; Every access logged
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
