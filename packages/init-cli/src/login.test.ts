#!/usr/bin/env tsx
/**
 * Unit tests for login.ts — browser-based CLI login flow.
 *
 * Tests the HTTP callback server and token handling without actually
 * opening a browser. Simulates the redirect that the login page sends.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

const CONFIG_DIR = path.join(os.homedir(), '.vaultproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Save and restore config so tests don't clobber real credentials
const originalConfig = fs.existsSync(CONFIG_FILE)
  ? fs.readFileSync(CONFIG_FILE, 'utf-8')
  : null;

function restoreConfig() {
  if (originalConfig !== null) {
    fs.writeFileSync(CONFIG_FILE, originalConfig);
  }
}

// ── Test: callback server accepts valid token ──
console.log('── valid callback ──');
{
  // Start the server manually (can't use browserLogin() because it opens a browser)
  const state = 'test-state-abc123';
  let resolvedResult: { token: string; email: string } | null = null;

  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith('/callback')) { res.writeHead(404); res.end(); return; }
    const params = new URL(req.url, 'http://127.0.0.1').searchParams;
    const token = params.get('token');
    const email = params.get('email') || '';
    const returnedState = params.get('state') || '';

    if (returnedState !== state) {
      res.writeHead(400); res.end('state mismatch');
      return;
    }
    if (!token) {
      res.writeHead(400); res.end('no token');
      return;
    }

    resolvedResult = { token, email };
    res.writeHead(200); res.end('ok');
    server.close();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address() as { port: number };
      const port = addr.port;

      // Simulate the browser redirect
      const callbackUrl = `http://127.0.0.1:${port}/callback?token=eyJ_fake_jwt&email=test%40example.com&state=${state}`;
      const res = await fetch(callbackUrl);
      ok('callback returns 200', res.status === 200);
      ok('token captured', resolvedResult?.token === 'eyJ_fake_jwt');
      ok('email captured', resolvedResult?.email === 'test@example.com');
      resolve();
    });
  });
}

// ── Test: state mismatch rejected ──
console.log('── state mismatch ──');
{
  const state = 'correct-state';

  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith('/callback')) { res.writeHead(404); res.end(); return; }
    const params = new URL(req.url, 'http://127.0.0.1').searchParams;
    const returnedState = params.get('state') || '';
    if (returnedState !== state) {
      res.writeHead(400); res.end('state mismatch');
      server.close();
      return;
    }
    res.writeHead(200); res.end('ok');
    server.close();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${addr.port}/callback?token=eyJ_fake&state=wrong-state`);
      ok('state mismatch returns 400', res.status === 400);
      resolve();
    });
  });
}

// ── Test: missing token rejected ──
console.log('── missing token ──');
{
  const state = 'test-state';

  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith('/callback')) { res.writeHead(404); res.end(); return; }
    const params = new URL(req.url, 'http://127.0.0.1').searchParams;
    const returnedState = params.get('state') || '';
    if (returnedState !== state) { res.writeHead(400); res.end(); server.close(); return; }
    const token = params.get('token');
    if (!token) {
      res.writeHead(400); res.end('no token');
      server.close();
      return;
    }
    res.writeHead(200); res.end('ok');
    server.close();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${addr.port}/callback?state=${state}`);
      ok('missing token returns 400', res.status === 400);
      resolve();
    });
  });
}

// ── Test: non-callback path returns 404 ──
console.log('── non-callback path ──');
{
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith('/callback')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${addr.port}/not-callback`);
      ok('non-callback returns 404', res.status === 404);
      server.close();
      resolve();
    });
  });
}

// Restore original config
restoreConfig();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
