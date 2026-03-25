import chalk from "chalk";
import { getApiUrl, getToken, getApiKey } from "./config.js";

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

  return headers;
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
  const baseUrl = getApiUrl();
  const url = `${baseUrl}${path}`;
  const auth = options.auth ?? "jwt";
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
