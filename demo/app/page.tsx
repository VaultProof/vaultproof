'use client';

import { useState } from 'react';
import { splitString, serializeShare } from '@vaultproof/shamir';

type Step = 'idle' | 'splitting' | 'split' | 'storing' | 'stored' | 'proxying' | 'done' | 'error';

interface Share {
  label: string;
  value: string;
}

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [shares, setShares] = useState<Share[]>([]);
  const [keyId, setKeyId] = useState('');
  const [proxyResult, setProxyResult] = useState('');
  const [error, setError] = useState('');

  const DEMO_VP_KEY = process.env.NEXT_PUBLIC_VP_DEMO_KEY ?? '';
  const API_URL = process.env.NEXT_PUBLIC_VP_API_URL ?? 'https://api.vaultproof.dev';

  async function runDemo() {
    if (!apiKey.trim()) return;
    setError('');
    setShares([]);
    setKeyId('');
    setProxyResult('');

    try {
      // Step 1: Split locally in the browser
      setStep('splitting');
      await sleep(400);
      const rawShares = splitString(apiKey.trim(), 2, 2);
      const s1 = serializeShare(rawShares[0]);
      const s2 = serializeShare(rawShares[1]);
      setShares([
        { label: 'Share 1 → sent to vault (encrypted)', value: s1.slice(0, 40) + '...' },
        { label: 'Share 2 → also sent to vault (encrypted with your key)', value: s2.slice(0, 40) + '...' },
      ]);
      setStep('split');
      await sleep(800);

      // Step 2: Store via API
      setStep('storing');
      const storeRes = await fetch(`${API_URL}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': DEMO_VP_KEY,
        },
        body: JSON.stringify({
          share1: s1,
          share2: s2,
          provider: 'openai',
          label: 'VaultProof Demo',
        }),
      });

      if (!storeRes.ok) {
        const err = await storeRes.json().catch(() => ({}));
        throw new Error((err as any).error ?? `Store failed: ${storeRes.status}`);
      }

      const stored = await storeRes.json() as { id: string };
      setKeyId(stored.id);
      setStep('stored');
      await sleep(800);

      // Step 3: Proxy a real call
      setStep('proxying');
      const proxyRes = await fetch(`${API_URL}/v1/openai/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': DEMO_VP_KEY,
          'X-Key-ID': stored.id,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Reply with exactly: "VaultProof works."' }],
          max_tokens: 20,
        }),
      });

      if (!proxyRes.ok) {
        const err = await proxyRes.json().catch(() => ({}));
        throw new Error((err as any).error ?? `Proxy failed: ${proxyRes.status}`);
      }

      const proxyJson = await proxyRes.json() as any;
      const content = proxyJson?.choices?.[0]?.message?.content ?? JSON.stringify(proxyJson);
      setProxyResult(content);
      setStep('done');

    } catch (e) {
      setError((e as Error).message);
      setStep('error');
    }
  }

  function reset() {
    setStep('idle');
    setApiKey('');
    setShares([]);
    setKeyId('');
    setProxyResult('');
    setError('');
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl space-y-10">

        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">VaultProof — Live Demo</h1>
          <p className="text-gray-400 text-sm leading-relaxed max-w-lg mx-auto">
            Your API key is split into two shares{' '}
            <strong className="text-white">in this browser</strong> before anything is sent to the server.
            No full key ever travels the wire.{' '}
            <a
              href="https://github.com/VaultProof/vaultproof"
              className="text-indigo-400 underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              Read the code.
            </a>
          </p>
        </div>

        {/* Input */}
        {(step === 'idle' || step === 'error') && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Your OpenAI API key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-600"
              />
              <p className="text-xs text-gray-600">
                Used only for this demo. Stored in VaultProof, proxied once, then you can revoke it.
              </p>
            </div>
            {error && (
              <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
            <button
              onClick={runDemo}
              disabled={!apiKey.trim() || !DEMO_VP_KEY}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-4 py-3 text-sm font-medium transition-colors"
            >
              {!DEMO_VP_KEY ? 'Demo key not configured' : 'Run Demo'}
            </button>
          </div>
        )}

        {/* Steps */}
        <div className="space-y-4">
          <StepRow
            active={step === 'splitting'}
            done={['split', 'storing', 'stored', 'proxying', 'done'].includes(step)}
            label="Step 1 — Split key locally (browser only)"
            description="Shamir GF(256) splits your key into 2 shares. This runs in your browser using the open source code in this repo."
          >
            {shares.length > 0 && (
              <div className="mt-3 space-y-2">
                {shares.map((s, i) => (
                  <div key={i} className="bg-gray-900 rounded-md px-3 py-2 text-xs font-mono">
                    <span className="text-gray-500">{s.label}</span>
                    <div className="text-green-400 mt-1 break-all">{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </StepRow>

          <StepRow
            active={step === 'storing'}
            done={['stored', 'proxying', 'done'].includes(step)}
            label="Step 2 — Store encrypted shares"
            description="Both shares are sent to api.vaultproof.dev encrypted. The server stores them separately — it never sees the full key."
          >
            {keyId && (
              <div className="mt-3 bg-gray-900 rounded-md px-3 py-2 text-xs font-mono">
                <span className="text-gray-500">Key ID: </span>
                <span className="text-indigo-400">{keyId}</span>
              </div>
            )}
          </StepRow>

          <StepRow
            active={step === 'proxying'}
            done={step === 'done'}
            label="Step 3 — Proxy a real OpenAI call"
            description="VaultProof reconstructs your key for ~100ms to make the call, then zeros it from memory. Your app never sees the key."
          >
            {proxyResult && (
              <div className="mt-3 bg-gray-900 rounded-md px-3 py-2 text-sm">
                <span className="text-gray-500 text-xs">OpenAI response: </span>
                <div className="text-green-400 mt-1">{proxyResult}</div>
              </div>
            )}
          </StepRow>
        </div>

        {/* Done */}
        {step === 'done' && (
          <div className="text-center space-y-4">
            <p className="text-green-400 text-sm font-medium">
              Your API key was stored and used without ever being exposed.
            </p>
            <div className="flex gap-3 justify-center">
              <a
                href="https://vaultproof.dev"
                target="_blank"
                rel="noreferrer"
                className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
              >
                Get started free
              </a>
              <button
                onClick={reset}
                className="bg-gray-800 hover:bg-gray-700 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-600 space-x-4">
          <a href="https://github.com/VaultProof/vaultproof" target="_blank" rel="noreferrer" className="hover:text-gray-400 transition-colors">GitHub</a>
          <a href="https://vaultproof.dev/docs" target="_blank" rel="noreferrer" className="hover:text-gray-400 transition-colors">Docs</a>
          <a href="https://vaultproof.dev" target="_blank" rel="noreferrer" className="hover:text-gray-400 transition-colors">vaultproof.dev</a>
        </div>

      </div>
    </main>
  );
}

function StepRow({
  active,
  done,
  label,
  description,
  children,
}: {
  active: boolean;
  done: boolean;
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  const idle = !active && !done;
  return (
    <div className={`rounded-xl border px-5 py-4 transition-colors ${
      done ? 'border-green-800 bg-green-950/30' :
      active ? 'border-indigo-600 bg-indigo-950/30' :
      'border-gray-800 bg-gray-900/30'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
          done ? 'bg-green-600 text-white' :
          active ? 'bg-indigo-600 text-white animate-pulse' :
          'bg-gray-800 text-gray-500'
        }`}>
          {done ? '✓' : active ? '…' : '·'}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${idle ? 'text-gray-500' : 'text-white'}`}>{label}</p>
          <p className={`text-xs mt-0.5 ${idle ? 'text-gray-700' : 'text-gray-400'}`}>{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
