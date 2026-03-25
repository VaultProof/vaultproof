"use client";

import { useState } from "react";
import Link from "next/link";

interface KeySlot {
  id: string;
  provider: string;
  label: string;
  status: string;
  createdAt: string;
  appGrants: { id: string; appName: string; grantedAt: string }[];
}

// Demo data for the dashboard (replace with real API calls)
const DEMO_KEYS: KeySlot[] = [
  {
    id: "ks_001",
    provider: "openai",
    label: "Production GPT-4",
    status: "ACTIVE",
    createdAt: "2026-03-20T10:00:00Z",
    appGrants: [
      { id: "g1", appName: "My AI Chat", grantedAt: "2026-03-20T10:00:00Z" },
      { id: "g2", appName: "Code Assistant", grantedAt: "2026-03-21T14:00:00Z" },
    ],
  },
  {
    id: "ks_002",
    provider: "anthropic",
    label: "Claude API",
    status: "ACTIVE",
    createdAt: "2026-03-22T08:30:00Z",
    appGrants: [
      { id: "g3", appName: "My AI Chat", grantedAt: "2026-03-22T08:30:00Z" },
    ],
  },
  {
    id: "ks_003",
    provider: "google",
    label: "Gemini Testing",
    status: "ACTIVE",
    createdAt: "2026-03-23T16:00:00Z",
    appGrants: [],
  },
];

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-green-500/10 text-green-400 border-green-500/20",
  anthropic: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  google: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  together: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

export default function KeysDashboard() {
  const [keys] = useState<KeySlot[]>(DEMO_KEYS);
  const [showAddKey, setShowAddKey] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto border-b border-gray-800">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">&#128274;</span>
          <span className="text-xl font-bold">VaultProof</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">demo@riallabs.com</span>
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">
            N
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
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
                      Created {new Date(key.createdAt).toLocaleDateString()} &middot;{" "}
                      {key.appGrants.length} app{key.appGrants.length !== 1 ? "s" : ""} connected
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
              {key.appGrants.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <div className="text-xs text-gray-500 mb-2">Connected Apps</div>
                  <div className="flex flex-wrap gap-2">
                    {key.appGrants.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <span className="text-gray-300">{grant.appName}</span>
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
                  <div className="text-lg font-bold text-white">
                    {Math.floor(Math.random() * 500)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Last Used</div>
                  <div className="text-sm text-gray-300">2 min ago</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">ZK Proofs</div>
                  <div className="text-sm text-green-400">All verified</div>
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
      </div>
    </div>
  );
}
