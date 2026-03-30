import chalk from "chalk";
import { getApiUrl, getDirectUrl, getToken, getApiKey, updateConfig } from "./config.js";

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
}

export type AuthMode = "jwt" | "apikey";

// In-memory session token — never written to disk
let sessionToken: string | null = null;
let sessionExpiresAt: number = 0;
let sessionRefreshPromise: Promise<void> | null = null;

// In-memory refresh token — set after login, never persisted to disk
let inMemoryRefreshToken: string | null = null;

/** Store the Supabase refresh token in memory (set once after login). */
export function setInMemoryRefreshToken(token: string): void {
  inMemoryRefreshToken = token;
}

/** Returns the expiry timestamp (ms) of a JWT, or 0 if unparseable. */
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    );
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Refresh the Supabase access token using the stored refresh token.
 * Updates config on success. Silent on failure.
 */
async function refreshJwt(): Promise<void> {
  const refreshToken = inMemoryRefreshToken;
  if (!refreshToken) return;

  try {
    const baseUrl = getApiUrl();
    const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        token: string;
        refreshToken: string;
      };
      // Write new JWT to disk so management commands keep working; keep refresh token in memory only
      updateConfig({ token: data.token });
      inMemoryRefreshToken = data.refreshToken;
    }
  } catch {
    // Network failure — keep existing JWT
  }
}

function getAuthHeaders(mode: AuthMode): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (mode === "jwt") {
    const token = getToken();
    if (!token) {
      console.error(
        chalk.red("Not authenticated. Run `vaultproof login` first.")
      );
      process.exit(1);
    }
    headers["Authorization"] = `Bearer ${token}`;
  } else if (mode === "apikey") {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error(
        chalk.red(
          "No API key found. Set VAULTPROOF_API_KEY or create one with `vaultproof dev-key create`."
        )
      );
      process.exit(1);
    }
    headers["X-API-Key"] = apiKey;
  }

  // Attach session token if we have one (in-memory only)
  if (sessionToken && Date.now() < sessionExpiresAt) {
    headers["X-VaultProof-Session"] = sessionToken;
  }

  return headers;
}

/**
 * Fetch a new session token from the server.
 * Requires BOTH a valid Supabase JWT and the vp_live_ key.
 */
export async function refreshSessionToken(devKeyId: string): Promise<void> {
  // Prevent concurrent refresh calls
  if (sessionRefreshPromise) {
    await sessionRefreshPromise;
    return;
  }

  sessionRefreshPromise = (async () => {
    const baseUrl = getApiUrl();

    // Refresh JWT first if it expires within 5 minutes
    const currentToken = getToken();
    if (currentToken) {
      const expiry = jwtExpiry(currentToken);
      if (expiry > 0 && expiry - Date.now() < 5 * 60 * 1000) {
        await refreshJwt();
      }
    }

    const token = getToken();
    const apiKey = getApiKey();

    if (!token || !apiKey) return;

    try {
      const response = await fetch(
        `${baseUrl}/api/v1/dev-keys/${devKeyId}/session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-API-Key": apiKey,
          },
        }
      );

      if (response.ok) {
        const data = (await response.json()) as {
          token: string;
          expiresAt: string;
        };
        sessionToken = data.token;
        sessionExpiresAt = new Date(data.expiresAt).getTime();
      } else if (response.status === 401 || response.status === 403) {
        // JWT expired or key revoked — clear session so we don't keep sending a bad token
        sessionToken = null;
        sessionExpiresAt = 0;
        console.warn(chalk.yellow('\nWarning: VaultProof session expired. Run `vaultproof login` to restore full security.'));
      }
      // Other non-2xx (e.g. 500) — keep old token until it expires naturally
    } catch {
      // Network failure — keep old token, stay quiet
    }
  })();

  try {
    await sessionRefreshPromise;
  } finally {
    sessionRefreshPromise = null;
  }
}

/**
 * Start a background interval that refreshes the session token every 4 min.
 * Returns a cleanup function to stop the interval.
 */
export function startSessionRefresh(devKeyId: string): () => void {
  const interval = setInterval(() => {
    refreshSessionToken(devKeyId).catch(() => {});
  }, 4 * 60 * 1000); // Refresh at 4 min (token lasts 5 min)

  return () => clearInterval(interval);
}

export function clearSession(): void {
  sessionToken = null;
  sessionExpiresAt = 0;
  inMemoryRefreshToken = null;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    auth?: AuthMode;
    stream?: boolean;
  } = {}
): Promise<ApiResponse<T>> {
  const auth = options.auth ?? "jwt";
  const baseUrl = auth === "apikey" ? getDirectUrl() : getApiUrl();
  const url = `${baseUrl}${path}`;
  const headers = getAuthHeaders(auth);

  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Network error: ${message}`));
    console.error(
      chalk.dim(`  Tried to reach: ${url}`)
    );
    process.exit(1);
  }

  if (options.stream && response.ok && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let done = false;

    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        process.stdout.write(decoder.decode(result.value, { stream: !done }));
      }
    }
    process.stdout.write("\n");

    return { ok: true, status: response.status, data: {} as T };
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    data = {} as T;
  }

  if (!response.ok) {
    const errBody = data as unknown as ApiErrorBody;
    const msg =
      errBody.error || errBody.message || `HTTP ${response.status}`;
    console.error(chalk.red(`API error: ${msg}`));
    process.exit(1);
  }

  return { ok: true, status: response.status, data };
}

export async function apiRequestNoAuth<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const baseUrl = getApiUrl();
  const url = `${baseUrl}${path}`;

  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Network error: ${message}`));
    console.error(
      chalk.dim(`  Tried to reach: ${url}`)
    );
    process.exit(1);
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    data = {} as T;
  }

  if (!response.ok) {
    const errBody = data as unknown as ApiErrorBody;
    const msg =
      errBody.error || errBody.message || `HTTP ${response.status}`;
    console.error(chalk.red(`API error: ${msg}`));
    process.exit(1);
  }

  return { ok: true, status: response.status, data };
}
