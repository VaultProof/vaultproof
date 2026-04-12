/**
 * Browser-based login for the init CLI.
 *
 * Flow:
 *   1. Start a local HTTP server on a random port
 *   2. Open vaultproof.dev/app/login?cli_callback=http://127.0.0.1:PORT/callback
 *   3. User logs in via GitHub/Google
 *   4. Login page redirects to our callback with the JWT
 *   5. We catch it, save to ~/.vaultproof/config.json, close the server
 *
 * The login page already supports cli_callback (validated: localhost only,
 * http/https, returns token + refresh_token + email in query params).
 */
import http from 'node:http';
import { readConfig } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.vaultproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const LOGIN_URL = 'https://vaultproof.dev/app/login';
const TIMEOUT_MS = 120_000; // 2 minutes

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function saveConfig(token: string, email: string): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const existing = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    : {};
  const updated = { ...existing, token, email };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
}

export interface LoginResult {
  token: string;
  email: string;
}

/**
 * Opens the browser for login and waits for the callback.
 * Returns the JWT on success, or null if the user cancels / times out.
 */
export async function browserLogin(): Promise<LoginResult | null> {
  const state = randomState();

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const params = new URL(req.url, `http://127.0.0.1`).searchParams;
      const token = params.get('token');
      const email = params.get('email') || '';
      const returnedState = params.get('state') || '';

      // Validate state to prevent CSRF
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#0a0a0f;color:#ef4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>Login Failed</h1><p>State mismatch. Please try again.</p></div></body></html>');
        cleanup(null);
        return;
      }

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#0a0a0f;color:#ef4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>Login Failed</h1><p>No token received. Please try again.</p></div></body></html>');
        cleanup(null);
        return;
      }

      // Save token
      saveConfig(token, email);

      // Success page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="background:#0a0a0f;color:#22c55e;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:2rem">&#10003; Logged in</h1><p style="color:#6b7280;margin-top:0.5rem">You can close this tab and return to your terminal.</p></div></body></html>');

      cleanup({ token, email });
    });

    let timeoutHandle: NodeJS.Timeout;

    function cleanup(result: LoginResult | null) {
      clearTimeout(timeoutHandle);
      server.close();
      resolve(result);
    }

    // Listen on random port
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        cleanup(null);
        return;
      }

      const port = addr.port;
      const callbackUrl = `http://127.0.0.1:${port}/callback`;
      const loginUrl = `${LOGIN_URL}?cli_callback=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;

      // Open browser
      const openCmd = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open';

      import('node:child_process').then(({ exec }) => {
        exec(`${openCmd} "${loginUrl}"`);
      });

      // Timeout after 2 minutes
      timeoutHandle = setTimeout(() => {
        cleanup(null);
      }, TIMEOUT_MS);
    });
  });
}
