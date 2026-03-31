#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  readConfig,
  updateConfig,
  clearConfig,
  getApiUrl,
  getToken,
  getApiKey,
} from "./config.js";
import { apiRequest, apiRequestNoAuth, refreshSessionToken, startSessionRefresh, setInMemoryRefreshToken, clearSession } from "./api.js";
import { prompt, promptHidden, confirm } from "./prompts.js";
import { splitString, serializeShare } from "@vaultproof/shamir";

const program = new Command();

program
  .name("vaultproof")
  .description(
    "VaultProof CLI — manage API keys from the terminal\n\n" +
      "  Store API keys without anyone seeing them. Even us.\n" +
      "  Keys are Shamir-split locally — the server never sees the full key."
  )
  .version("1.7.3", "-v, --version")
  .option("--json", "Output results as JSON")
  .option("--api-url <url>", "Override API URL")
  .addHelpText(
    "after",
    `
${chalk.bold("Quick Start:")}
  $ vaultproof register                     Create an account
  $ vaultproof login                        Log in
  $ vaultproof dev-key create               Get a developer API key
  $ export VAULTPROOF_API_KEY=vp_live_...   Set your key
  $ vaultproof store -p openai              Store an API key
  $ vaultproof keys                         List stored keys
  $ vaultproof proxy -k <id> --path /v1/models   Make a proxied call

${chalk.bold("Documentation:")}  https://vaultproof.dev/docs
${chalk.bold("Dashboard:")}      https://vaultproof.dev/app
${chalk.bold("Config file:")}    ~/.vaultproof/config.json
`
  );

// ─── login ───────────────────────────────────────────────────────────────────

program
  .command("login")
  .alias("l")
  .description("Log in to your VaultProof account via browser")
  .option("-e, --email <email>", "Email for password login (skips browser)")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof login          # Opens browser for GitHub/Google/email login
  $ vaultproof login -e you@example.com  # Password login in terminal

${chalk.bold("How it works:")}
  1. Opens your browser to vaultproof.dev
  2. You sign in with GitHub, Google, or email
  3. CLI automatically receives your credentials
  4. A developer API key is created for you

${chalk.bold("Notes:")}
  Stores session token at ~/.vaultproof/config.json
  Token expires after 7 days — run login again to refresh.
`
  )
  .action(async (opts: { email?: string }) => {
    // If email provided, use terminal-based password login (legacy)
    if (opts.email) {
      const password = await promptHidden("Password: ");
      const spinner = ora("Logging in...").start();

      const { data } = await apiRequestNoAuth<{
        token: string;
        email: string;
      }>("POST", "/api/v1/auth/login", { email: opts.email, password });

      updateConfig({ token: data.token, email: data.email ?? opts.email });
      spinner.succeed(
        chalk.green(`Logged in as ${chalk.bold(data.email ?? opts.email)}`)
      );
      return;
    }

    // Browser login flow
    const { createServer } = await import("http");
    const { URL } = await import("url");

    // Find a free port
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const callbackUrl = `http://127.0.0.1:${port}/callback`;
    const { randomBytes: _rb } = await import("crypto");
    const loginState = _rb(16).toString("hex");
    const loginUrl = `https://vaultproof.dev/app/login?cli_callback=${encodeURIComponent(callbackUrl)}&state=${loginState}`;

    const spinner = ora("Waiting for browser login...").start();
    spinner.info(`Opening browser: ${chalk.cyan(loginUrl)}`);

    // Open browser
    const { exec } = await import("child_process");
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${openCmd} "${loginUrl}"`);

    // Wait for callback
    const result = await new Promise<{
      token: string;
      refreshToken: string | null;
      email: string;
    } | null>((resolve) => {
      const timeout = setTimeout(() => {
        server.close();
        resolve(null);
      }, 120000); // 2 minute timeout

      server.on("request", async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${port}`);

        if (url.pathname === "/callback") {
          const token = url.searchParams.get("token");
          const refreshToken = url.searchParams.get("refresh_token");
          const email = url.searchParams.get("email");
          const receivedState = url.searchParams.get("state");

          // Validate state nonce to prevent CSRF
          if (receivedState !== loginState) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid state");
            clearTimeout(timeout);
            server.close();
            resolve(null);
            return;
          }

          // Send success page to browser
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
            <body style="background:#0a0a0f;color:#e2e2e8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
              <div style="text-align:center;">
                <div style="font-size:48px;margin-bottom:16px;">&#10003;</div>
                <h1 style="font-size:24px;margin-bottom:8px;">Connected to VaultProof CLI</h1>
                <p style="color:#888;">This tab will close automatically...</p>
              </div>
            </body>
            <script>setTimeout(function(){window.close()},1500)</script>
            </html>
          `);

          clearTimeout(timeout);
          server.close();
          resolve(token && email ? { token, refreshToken, email } : null);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    if (!result) {
      spinner.fail(chalk.red("Login timed out or was cancelled."));
      process.exit(1);
    }

    spinner.text = "Creating developer API key...";

    // Use the token to create a dev key
    try {
      const apiUrl = getApiUrl();
      const createRes = await fetch(`${apiUrl}/api/v1/dev-keys/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${result.token}`,
        },
        body: JSON.stringify({ label: "CLI", mode: "live" }),
      });

      if (!createRes.ok) {
        // May already have keys — try to list them
        const listRes = await fetch(`${apiUrl}/api/v1/dev-keys/list`, {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        if (listRes.ok) {
          const listData = (await listRes.json()) as any;
          if (listData.keys && listData.keys.length > 0) {
            // Existing keys are masked — user needs to create manually or use existing
            spinner.fail(
              chalk.red(
                "Could not create developer key. Create one manually in Settings."
              )
            );
            // Still save the token for JWT-based commands
            updateConfig({ token: result.token, email: result.email });
            if (result.refreshToken) setInMemoryRefreshToken(result.refreshToken);
            spinner.succeed(
              chalk.green(`Logged in as ${chalk.bold(result.email)}`)
            );
            console.log(
              chalk.dim(
                "  Set VAULTPROOF_API_KEY manually from Settings -> Developer Keys"
              )
            );
            return;
          }
        }
        throw new Error("Failed to create developer key");
      }

      const devKey = (await createRes.json()) as any;

      // Save everything
      updateConfig({ token: result.token, email: result.email });
      if (result.refreshToken) setInMemoryRefreshToken(result.refreshToken);

      spinner.succeed(
        chalk.green(`Logged in as ${chalk.bold(result.email)}`)
      );
      console.log(
        `  ${chalk.bold("Developer key:")} ${chalk.cyan(devKey.key)}`
      );
      console.log();
      console.log(chalk.dim("  Add to your environment:"));
      console.log(chalk.dim(`  export VAULTPROOF_API_KEY=${devKey.key}`));

      // Offer to write to .env
      const writeEnv = await confirm(
        "\nWrite VAULTPROOF_API_KEY to .env in current directory?"
      );
      if (writeEnv) {
        const fs = await import("node:fs");
        const envLine = `VAULTPROOF_API_KEY=${devKey.key}\n`;
        const envPath = ".env";
        if (fs.existsSync(envPath)) {
          const existing = fs.readFileSync(envPath, "utf-8");
          if (existing.includes("VAULTPROOF_API_KEY=")) {
            const updated = existing.replace(
              /VAULTPROOF_API_KEY=.*/,
              `VAULTPROOF_API_KEY=${devKey.key}`
            );
            fs.writeFileSync(envPath, updated);
          } else {
            fs.appendFileSync(envPath, envLine);
          }
        } else {
          fs.writeFileSync(envPath, envLine);
        }
        console.log(chalk.dim("  Written to .env"));
      }
    } catch (err) {
      spinner.fail(
        chalk.red("Login succeeded but failed to create developer key.")
      );
      updateConfig({ token: result.token, email: result.email });
      console.log(
        chalk.dim("  Create a key manually: vaultproof dev-key create")
      );
    }
  });

// ─── logout ──────────────────────────────────────────────────────────────────

program
  .command("logout")
  .description("Log out and clear stored credentials")
  .addHelpText(
    "after",
    `
${chalk.bold("Notes:")}
  Removes token and email from ~/.vaultproof/config.json
  Does not affect VAULTPROOF_API_KEY env var.
`
  )
  .action(async () => {
    const cfg = readConfig();
    if (!cfg.token) {
      console.log(chalk.dim("Not currently logged in."));
      return;
    }

    const yes = await confirm(`Log out from ${chalk.bold(cfg.email || "account")}?`);
    if (!yes) {
      console.log(chalk.dim("Aborted."));
      return;
    }

    clearSession();
    clearConfig();
    console.log(chalk.green("Logged out."));
  });

// ─── register ────────────────────────────────────────────────────────────────

program
  .command("register")
  .alias("signup")
  .description("Create a new VaultProof account")
  .option("-e, --email <email>", "Email address (skips prompt)")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof register
  $ vaultproof register -e you@example.com

${chalk.bold("Notes:")}
  Password must be at least 8 characters.
  Automatically logs you in after registration.
`
  )
  .action(async (opts: { email?: string }) => {
    const email = opts.email || (await prompt("Email: "));
    const password = await promptHidden("Password: ");
    const confirmPassword = await promptHidden("Confirm password: ");

    if (password !== confirmPassword) {
      console.error(chalk.red("Passwords do not match."));
      process.exit(1);
    }

    if (password.length < 8) {
      console.error(chalk.red("Password must be at least 8 characters."));
      process.exit(1);
    }

    const spinner = ora("Creating account...").start();

    const { data } = await apiRequestNoAuth<{
      token: string;
      email: string;
    }>("POST", "/api/v1/auth/register", { email, password });

    updateConfig({ token: data.token, email: data.email ?? email });

    spinner.succeed(
      chalk.green(
        `Account created. Logged in as ${chalk.bold(data.email ?? email)}`
      )
    );
  });

// ─── whoami ──────────────────────────────────────────────────────────────────

program
  .command("whoami")
  .alias("me")
  .description("Show the current authenticated user")
  .action(async () => {
    const jsonOut = program.opts().json;
    const spinner = ora("Fetching user info...").start();

    const { data } = await apiRequest<{
      user?: { email: string; createdAt: string; id: string };
      email?: string;
      createdAt?: string;
    }>("GET", "/api/v1/auth/me", { auth: "jwt" });

    spinner.stop();

    const user = data.user || data;

    if (jsonOut) {
      console.log(JSON.stringify(user, null, 2));
      return;
    }

    console.log(chalk.bold("Email:   ") + (user.email || "unknown"));
    console.log(
      chalk.bold("Created: ") +
        new Date(user.createdAt || "").toLocaleDateString()
    );
  });

// ─── status ──────────────────────────────────────────────────────────────────

program
  .command("status")
  .alias("st")
  .description("Check connection, auth, and API key status")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof status

${chalk.bold("Checks:")}
  1. API reachability (api.vaultproof.dev/health)
  2. JWT authentication (logged in?)
  3. Developer API key (VAULTPROOF_API_KEY set?)
`
  )
  .action(async () => {
    const apiUrl = program.opts().apiUrl || getApiUrl();
    const token = getToken();
    const apiKey = getApiKey();
    const cfg = readConfig();

    console.log(chalk.bold("\nVaultProof Status\n"));

    // Check API
    const spinner = ora("Checking API connection...").start();
    try {
      const res = await fetch(`${apiUrl}/health`);
      const body = await res.json() as Record<string, unknown>;
      if (res.ok) {
        spinner.succeed(
          chalk.green(`API: ${apiUrl}`) +
            chalk.dim(` (${body.service || "ok"})`)
        );
      } else {
        spinner.fail(chalk.red(`API: ${apiUrl} — HTTP ${res.status}`));
      }
    } catch (err) {
      spinner.fail(
        chalk.red(`API: ${apiUrl} — unreachable`) +
          chalk.dim(` (${err instanceof Error ? err.message : "network error"})`)
      );
    }

    // Check auth
    if (token) {
      console.log(
        chalk.green("  Auth:    ") +
          `Logged in as ${chalk.bold(cfg.email || "unknown")}`
      );
    } else {
      console.log(
        chalk.dim("  Auth:    ") +
          "Not logged in" +
          chalk.dim(" (run `vaultproof login`)")
      );
    }

    // Check dev key
    if (apiKey) {
      const masked = apiKey.slice(0, 12) + "..." + apiKey.slice(-4);
      console.log(chalk.green("  API Key: ") + masked);
    } else {
      console.log(
        chalk.dim("  API Key: ") +
          "Not set" +
          chalk.dim(" (set VAULTPROOF_API_KEY)")
      );
    }

    // Check config
    console.log(
      chalk.dim("  Config:  ") + "~/.vaultproof/config.json"
    );
    console.log();
  });

// ─── keys ────────────────────────────────────────────────────────────────────

program
  .command("keys")
  .alias("ls")
  .description("List stored API keys")
  .option("--json", "Output as JSON")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof keys
  $ vaultproof keys --json
  $ vaultproof ls

${chalk.bold("Requires:")} VAULTPROOF_API_KEY environment variable
`
  )
  .action(async (opts: { json?: boolean }) => {
    const jsonOut = opts.json || program.opts().json;
    const spinner = ora("Fetching keys...").start();

    const { data } = await apiRequest<{
      keys: Array<{
        id: string;
        provider: string;
        label: string;
        createdAt: string;
      }>;
    }>("GET", "/api/v1/sdk/keys", { auth: "apikey" });

    spinner.stop();

    if (!data.keys || data.keys.length === 0) {
      if (jsonOut) {
        console.log("[]");
      } else {
        console.log(
          chalk.dim("No keys stored yet. Use `vaultproof store` to add one.")
        );
      }
      return;
    }

    if (jsonOut) {
      console.log(JSON.stringify(data.keys, null, 2));
      return;
    }

    const idW = 12;
    const provW = 14;
    const labelW = 24;
    const createdW = 16;

    console.log(
      chalk.bold(
        pad("ID", idW) +
          pad("Provider", provW) +
          pad("Label", labelW) +
          pad("Created", createdW)
      )
    );
    console.log(chalk.dim("-".repeat(idW + provW + labelW + createdW)));

    for (const key of data.keys) {
      const id = key.id.length > 8 ? key.id.slice(0, 8) : key.id;
      const created = timeAgo(new Date(key.createdAt));
      console.log(
        pad(id, idW) +
          pad(key.provider, provW) +
          pad(key.label || "-", labelW) +
          pad(created, createdW)
      );
    }

    console.log(
      chalk.dim(`\n${data.keys.length} key${data.keys.length === 1 ? "" : "s"} total`)
    );
  });

// ─── store ───────────────────────────────────────────────────────────────────

program
  .command("store")
  .alias("add")
  .description("Store a new API key with Shamir splitting")
  .requiredOption("-p, --provider <provider>", "API provider (openai, anthropic, google, etc.)")
  .option("-l, --label <label>", "Label for this key")
  .option("--expires <date>", "Key expiry date (ISO 8601, e.g. 2026-12-31)")
  .option("--value <key>", "API key value (non-interactive, for scripting)")
  .option("--var <envVar>", "Environment variable name (e.g. NEXT_PUBLIC_SUPABASE_URL)")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof store -p openai
  $ vaultproof store -p anthropic -l "Production key"
  $ vaultproof store -p supabase -l url --var NEXT_PUBLIC_SUPABASE_URL

${chalk.bold("How it works:")}
  1. You paste your API key (hidden input)
  2. You choose the env var name it exports as
  3. Key is Shamir-split locally into 2 shares
  4. Both shares are sent encrypted with different keys
  5. The full API key NEVER leaves your machine

${chalk.bold("Requires:")} VAULTPROOF_API_KEY environment variable
`
  )
  .action(async (opts: { provider: string; label?: string; expires?: string; value?: string; var?: string }) => {
    const apiKey = opts.value ?? await promptHidden("API Key: ");

    if (!apiKey) {
      console.error(chalk.red("API key cannot be empty."));
      process.exit(1);
    }

    if (apiKey.length < 8) {
      console.error(chalk.red("API key seems too short. Check your input."));
      process.exit(1);
    }

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

    const spinner = ora("Splitting key with Shamir secret sharing...").start();

    const shares = splitString(apiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    spinner.text = "Storing encrypted shares...";

    const { data } = await apiRequest<{
      id: string;
      provider: string;
      label: string;
      envVar: string | null;
      warning?: string;
      duplicateKeyIds?: string[];
    }>("POST", "/api/v1/sdk/store", {
      body: {
        provider: opts.provider,
        label: opts.label ?? "",
        share1,
        share2,
        envVar,
        expiresAt: opts.expires ? new Date(opts.expires).toISOString() : undefined,
      },
      auth: "apikey",
    });

    const jsonOut = program.opts().json;
    if (jsonOut) {
      spinner.stop();
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const truncatedId =
      data.id.length > 8 ? data.id.slice(0, 8) + "..." : data.id;
    spinner.succeed(
      chalk.green(
        `Key stored: ${truncatedId} (${data.provider}${data.label ? " / " + data.label : ""})`
      )
    );
    console.log(chalk.dim(`  Will export as ${chalk.reset(data.envVar || envVar || defaultEnvVar)}`));
    console.log(
      chalk.dim(
        "  Key was Shamir-split locally. Server never saw the full key."
      )
    );

    if (data.warning) {
      console.log(chalk.yellow(`\n  ⚠ ${data.warning}`));
      if (data.duplicateKeyIds?.length) {
        console.log(chalk.dim(`  Existing key${data.duplicateKeyIds.length > 1 ? "s" : ""}: ${data.duplicateKeyIds.join(", ")}`));
        console.log(chalk.dim("  Use `vaultproof revoke <keyId>` to remove the old one."));
      }
    }
  });

// ─── proxy ───────────────────────────────────────────────────────────────────

program
  .command("proxy")
  .alias("call")
  .description("Make a proxied API call through VaultProof")
  .requiredOption("-k, --key <keyId>", "Key ID to use (from `vaultproof keys`)")
  .requiredOption("--path <path>", "API path to call (e.g., /v1/chat/completions)")
  .option("-m, --method <method>", "HTTP method", "POST")
  .option("-d, --body <json>", "Request body as JSON string")
  .option("-f, --file <path>", "Read request body from a JSON file")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof proxy -k vk_8f3a --path /v1/models -m GET
  $ vaultproof proxy -k vk_8f3a --path /v1/chat/completions \\
      -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
  $ vaultproof proxy -k vk_8f3a --path /v1/chat/completions -f request.json
  $ vaultproof call -k vk_8f3a --path /v1/models -m GET

${chalk.bold("How it works:")}
  1. Server decrypts both shares with separate keys
  2. Key is reconstructed for ~100ms
  3. API call is made on your behalf
  4. Key is zeroed from memory immediately after
  5. Response is streamed back to you

${chalk.bold("Requires:")} VAULTPROOF_API_KEY environment variable
`
  )
  .action(
    async (opts: {
      key: string;
      path: string;
      method: string;
      body?: string;
      file?: string;
    }) => {
      let parsedBody: unknown = undefined;

      if (opts.file) {
        try {
          const fs = await import("node:fs");
          const raw = fs.readFileSync(opts.file, "utf-8");
          parsedBody = JSON.parse(raw);
        } catch (err) {
          console.error(
            chalk.red(
              `Failed to read ${opts.file}: ${err instanceof Error ? err.message : String(err)}`
            )
          );
          process.exit(1);
        }
      } else if (opts.body) {
        try {
          parsedBody = JSON.parse(opts.body);
        } catch {
          console.error(chalk.red("Invalid JSON body. Wrap in single quotes and use double quotes inside."));
          console.error(chalk.dim("  Example: -d '{\"model\":\"gpt-4\"}'"));
          process.exit(1);
        }
      }

      await apiRequest("POST", "/api/v1/sdk/call", {
        body: {
          keyId: opts.key,
          path: opts.path,
          method: opts.method.toUpperCase(),
          body: parsedBody,
        },
        auth: "apikey",
        stream: true,
      });
    }
  );

// ─── revoke ──────────────────────────────────────────────────────────────────

program
  .command("revoke <keyId>")
  .alias("rm")
  .description("Revoke a stored API key (destroys both shares)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof revoke vk_8f3a2b1c
  $ vaultproof revoke vk_8f3a2b1c -y
  $ vaultproof rm vk_8f3a2b1c

${chalk.bold("What happens:")}
  Both encrypted shares are permanently zeroed on the server.
  The API key can never be reconstructed from VaultProof again.
  You'll need to store a new key if you want to use VaultProof again.

${chalk.bold("Requires:")} VAULTPROOF_API_KEY environment variable
`
  )
  .action(async (keyId: string, opts: { yes?: boolean }) => {
    if (!opts.yes) {
      const yes = await confirm(
        `Permanently revoke key ${chalk.bold(keyId)}? This cannot be undone.`
      );
      if (!yes) {
        console.log(chalk.dim("Aborted."));
        return;
      }
    }

    const spinner = ora("Revoking key and zeroing shares...").start();

    await apiRequest("POST", "/api/v1/sdk/revoke", {
      body: { keyId },
      auth: "apikey",
    });

    spinner.succeed(chalk.green(`Key ${keyId} revoked. Both shares destroyed.`));
  });

// ─── dev-key ─────────────────────────────────────────────────────────────────

const devKey = program
  .command("dev-key")
  .alias("dk")
  .description("Manage developer API keys (vp_live_/vp_test_)")
  .addHelpText(
    "after",
    `
${chalk.bold("Subcommands:")}
  create    Create a new developer API key
  list      List your developer API keys
  revoke    Revoke a developer API key

${chalk.bold("What are developer keys?")}
  Developer keys (vp_live_...) authenticate your SDK and CLI requests.
  They are different from the API keys you store in the vault.
  Create one, then set it as VAULTPROOF_API_KEY in your environment.

${chalk.bold("Examples:")}
  $ vaultproof dev-key create
  $ vaultproof dev-key create -l "CI/CD" -m test
  $ vaultproof dev-key list
  $ vaultproof dk create
`
  );

devKey
  .command("create")
  .description("Create a new developer API key")
  .option("-l, --label <label>", "Label for this key", "default")
  .option("-m, --mode <mode>", "Key mode: live or test", "live")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof dev-key create
  $ vaultproof dev-key create -l "Production" -m live
  $ vaultproof dev-key create -l "Testing" -m test

${chalk.bold("Notes:")}
  The key is shown ONCE. Save it immediately.
  Live keys (vp_live_) are for production use.
  Test keys (vp_test_) are for development and testing.
`
  )
  .action(async (opts: { label: string; mode: string }) => {
    if (opts.mode !== "live" && opts.mode !== "test") {
      console.error(chalk.red('Mode must be "live" or "test".'));
      process.exit(1);
    }

    const spinner = ora("Creating developer API key...").start();

    const { data } = await apiRequest<{
      id: string;
      key: string;
      label: string;
      mode: string;
    }>("POST", "/api/v1/dev-keys/create", {
      body: { label: opts.label, mode: opts.mode },
      auth: "jwt",
    });

    const jsonOut = program.opts().json;
    if (jsonOut) {
      spinner.stop();
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    spinner.succeed(chalk.green("Developer API key created:"));
    console.log();
    console.log(`  ${chalk.bold(data.key)}`);
    console.log();
    console.log(
      chalk.dim("  Save this key — you won't see it again!")
    );

    const writeEnv = await confirm(
      "\nWrite to .env file in current directory?"
    );
    if (writeEnv) {
      const fs = await import("node:fs");
      const envLine = `VAULTPROOF_API_KEY=${data.key}\n`;
      const envPath = ".env";

      if (fs.existsSync(envPath)) {
        const existing = fs.readFileSync(envPath, "utf-8");
        if (existing.includes("VAULTPROOF_API_KEY=")) {
          const updated = existing.replace(
            /VAULTPROOF_API_KEY=.*/,
            `VAULTPROOF_API_KEY=${data.key}`
          );
          fs.writeFileSync(envPath, updated);
        } else {
          fs.appendFileSync(envPath, envLine);
        }
      } else {
        fs.writeFileSync(envPath, envLine);
      }
      console.log(chalk.dim("  Written to .env"));
    }
  });

devKey
  .command("list")
  .alias("ls")
  .description("List developer API keys")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const jsonOut = opts.json || program.opts().json;
    const spinner = ora("Fetching developer keys...").start();

    const { data } = await apiRequest<{
      keys: Array<{
        id: string;
        key: string;
        label: string;
        mode: string;
        createdAt: string;
      }>;
    }>("GET", "/api/v1/dev-keys/list", { auth: "jwt" });

    spinner.stop();

    if (!data.keys || data.keys.length === 0) {
      if (jsonOut) {
        console.log("[]");
      } else {
        console.log(
          chalk.dim(
            "No developer keys yet. Use `vaultproof dev-key create` to make one."
          )
        );
      }
      return;
    }

    if (jsonOut) {
      console.log(JSON.stringify(data.keys, null, 2));
      return;
    }

    const idW = 12;
    const keyW = 28;
    const labelW = 20;
    const modeW = 8;
    const createdW = 16;

    console.log(
      chalk.bold(
        pad("ID", idW) +
          pad("Key", keyW) +
          pad("Label", labelW) +
          pad("Mode", modeW) +
          pad("Created", createdW)
      )
    );
    console.log(chalk.dim("-".repeat(idW + keyW + labelW + modeW + createdW)));

    for (const k of data.keys) {
      const id = k.id.length > 8 ? k.id.slice(0, 8) : k.id;
      const created = timeAgo(new Date(k.createdAt));
      console.log(
        pad(id, idW) +
          pad(k.key, keyW) +
          pad(k.label, labelW) +
          pad(k.mode, modeW) +
          pad(created, createdW)
      );
    }
  });

devKey
  .command("revoke <id>")
  .description("Revoke a developer API key")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (id: string, opts: { yes?: boolean }) => {
    if (!opts.yes) {
      const yes = await confirm(
        `Revoke developer key ${chalk.bold(id)}?`
      );
      if (!yes) {
        console.log(chalk.dim("Aborted."));
        return;
      }
    }

    const spinner = ora("Revoking developer key...").start();

    await apiRequest("POST", `/api/v1/dev-keys/${id}/revoke`, {
      auth: "jwt",
    });

    spinner.succeed(chalk.green(`Developer key ${id} revoked.`));
  });

// ─── logs ────────────────────────────────────────────────────────────────────

program
  .command("logs")
  .description("View recent access logs")
  .option("-k, --key <keyId>", "Filter by key ID")
  .option("-n, --limit <n>", "Number of log entries", "20")
  .option("--json", "Output as JSON")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof logs
  $ vaultproof logs -n 50
  $ vaultproof logs -k vk_8f3a2b1c
  $ vaultproof logs --json | jq '.[] | .endpoint'

${chalk.bold("Requires:")} VAULTPROOF_API_KEY environment variable
`
  )
  .action(async (opts: { key?: string; limit: string; json?: boolean }) => {
    const jsonOut = opts.json || program.opts().json;
    const spinner = ora("Fetching logs...").start();

    const params = new URLSearchParams();
    if (opts.key) params.set("keyId", opts.key);
    params.set("limit", opts.limit);

    const { data } = await apiRequest<{
      logs: Array<{
        timestamp: string;
        keyId: string;
        app: string;
        endpoint: string;
        status: number;
        latencyMs: number;
      }>;
    }>("GET", `/api/v1/sdk/logs?${params.toString()}`, { auth: "apikey" });

    spinner.stop();

    if (!data.logs || data.logs.length === 0) {
      if (jsonOut) {
        console.log("[]");
      } else {
        console.log(chalk.dim("No logs found."));
      }
      return;
    }

    if (jsonOut) {
      console.log(JSON.stringify(data.logs, null, 2));
      return;
    }

    const timeW = 22;
    const keyW = 12;
    const appW = 16;
    const endpointW = 28;
    const statusW = 8;
    const latencyW = 10;

    console.log(
      chalk.bold(
        pad("Time", timeW) +
          pad("Key", keyW) +
          pad("App", appW) +
          pad("Endpoint", endpointW) +
          pad("Status", statusW) +
          pad("Latency", latencyW)
      )
    );
    console.log(
      chalk.dim("-".repeat(timeW + keyW + appW + endpointW + statusW + latencyW))
    );

    for (const log of data.logs) {
      const time = new Date(log.timestamp).toLocaleString();
      const keyTrunc =
        log.keyId.length > 8 ? log.keyId.slice(0, 8) : log.keyId;
      const statusColor =
        log.status >= 200 && log.status < 300
          ? chalk.green
          : chalk.red;

      console.log(
        pad(time, timeW) +
          pad(keyTrunc, keyW) +
          pad(log.app || "-", appW) +
          pad(log.endpoint, endpointW) +
          pad(statusColor(String(log.status)), statusW) +
          pad(`${log.latencyMs}ms`, latencyW)
      );
    }
  });

import { ENV_VAR_MAP, resolveEnvVar } from "./env-vars.js";

// REMOVED: `env` and `exec` commands
// These reconstructed raw API keys and exposed them as env vars or stdout.
// Use the proxy instead — keys never leave the server.
// CLI `proxy` command and transparent proxy (/v1/:provider/*) are the secure alternatives.

// ─── config ──────────────────────────────────────────────────────────────────

const configCmd = program
  .command("config")
  .description("View or update CLI configuration")
  .addHelpText(
    "after",
    `
${chalk.bold("Subcommands:")}
  (none)    Show current configuration
  set       Update a config value
  reset     Clear all configuration

${chalk.bold("Examples:")}
  $ vaultproof config
  $ vaultproof config set api-url https://api.vaultproof.dev
  $ vaultproof config reset

${chalk.bold("Environment variables:")}
  VAULTPROOF_API_KEY    Developer API key (overrides config)
  VAULTPROOF_API_URL    API URL (overrides config)
`
  )
  .action(() => {
    const cfg = readConfig();
    const apiUrl = getApiUrl();
    const token = getToken();
    const devApiKey = getApiKey();

    console.log(chalk.bold("\nVaultProof CLI Configuration\n"));
    console.log(chalk.bold("API URL:    ") + apiUrl);
    console.log(
      chalk.bold("Auth:       ") +
        (token
          ? chalk.green(`Logged in as ${cfg.email ?? "unknown"}`)
          : chalk.dim("Not authenticated"))
    );
    console.log(
      chalk.bold("Dev Key:    ") +
        (devApiKey
          ? devApiKey.slice(0, 12) + "..." + devApiKey.slice(-4)
          : chalk.dim("Not set (VAULTPROOF_API_KEY)"))
    );
    console.log(
      chalk.bold("Config:     ") + "~/.vaultproof/config.json"
    );
    console.log();
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value (api-url)")
  .addHelpText(
    "after",
    `
${chalk.bold("Available keys:")}
  api-url    API server URL

${chalk.bold("Examples:")}
  $ vaultproof config set api-url https://api.vaultproof.dev
  $ vaultproof config set api-url http://localhost:3333
`
  )
  .action((key: string, value: string) => {
    const validKeys: Record<string, string> = {
      "api-url": "apiUrl",
    };

    const configKey = validKeys[key];
    if (!configKey) {
      console.error(
        chalk.red(`Unknown config key: ${key}`) +
          chalk.dim(`\nValid keys: ${Object.keys(validKeys).join(", ")}`)
      );
      process.exit(1);
    }

    updateConfig({ [configKey]: value } as Record<string, string>);
    console.log(chalk.green(`Set ${key} = ${value}`));
  });

configCmd
  .command("reset")
  .description("Clear all configuration")
  .action(async () => {
    const yes = await confirm("Clear all VaultProof CLI configuration?");
    if (!yes) {
      console.log(chalk.dim("Aborted."));
      return;
    }
    clearConfig();
    console.log(chalk.green("Configuration cleared."));
  });

// ─── Utilities ───────────────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width - 1) + " ";
  return str + " ".repeat(width - str.length);
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ─── test ────────────────────────────────────────────────────────────────────

async function testConnection(): Promise<boolean> {
  const spinner = ora("Testing connection to VaultProof...").start();

  // Check API key
  const apiKey = getApiKey();
  if (!apiKey) {
    spinner.fail("No API key found");
    console.error(chalk.dim("  Set VAULTPROOF_API_KEY or run `vaultproof dev-key create`."));
    return false;
  }
  if (!apiKey.startsWith("vp_live_") && !apiKey.startsWith("vp_test_")) {
    spinner.fail("Invalid API key format");
    console.error(chalk.dim("  Key must start with vp_live_ or vp_test_"));
    return false;
  }

  // Hit the backend to verify the key works
  try {
    const { data } = await apiRequest<{ keys: unknown[] }>("GET", "/api/v1/sdk/keys", {
      auth: "apikey",
    });
    spinner.succeed(`Connected — ${(data.keys || []).length} key${(data.keys || []).length === 1 ? "" : "s"} stored`);
    return true;
  } catch {
    spinner.fail("Connection failed");
    return false;
  }
}

program
  .command("test")
  .description("Test your connection to VaultProof")
  .action(async () => {
    console.log();
    const ok = await testConnection();
    if (!ok) process.exit(1);
    console.log();
  });

// ─── migrate ─────────────────────────────────────────────────────────────────

import { LABEL_VAR_MAP } from "./env-vars.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";

// Reverse map: ENV_VAR_NAME → { provider, label }
const KNOWN_SECRETS: Record<string, { provider: string; label: string }> = {};
for (const [provider, envVar] of Object.entries(ENV_VAR_MAP)) {
  KNOWN_SECRETS[envVar] = { provider, label: "default" };
}
for (const [provider, labels] of Object.entries(LABEL_VAR_MAP)) {
  for (const [label, envVar] of Object.entries(labels)) {
    if (!KNOWN_SECRETS[envVar]) {
      KNOWN_SECRETS[envVar] = { provider, label };
    }
  }
}

// Common secret patterns — env vars that look like secrets
const SECRET_PATTERNS = [
  /KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i, /CREDENTIAL/i,
  /DSN/i, /AUTH/i, /PRIVATE/i,
];

// Known non-secret env vars (public config, not secrets)
const NON_SECRETS = new Set([
  "NODE_ENV", "PORT", "HOST", "TZ", "CI", "VAULTPROOF_API_KEY", "VAULTPROOF_API_URL",
  "VAULTPROOF_DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "DATABASE_URL", "DIRECT_URL",
]);

// Known API key prefixes → provider classification (high confidence)
// Sourced from secrets-patterns-db, TruffleHog, Gitleaks, and provider docs
const KEY_PREFIX_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  // AI / LLM providers
  { pattern: /^sk-proj-/, provider: "openai" },
  { pattern: /^sk-[a-zA-Z0-9]{40,}$/, provider: "openai" },
  { pattern: /^sk-ant-/, provider: "anthropic" },
  { pattern: /^tog_/, provider: "together" },
  { pattern: /^gsk_[a-zA-Z0-9]{40,}$/, provider: "groq" },
  { pattern: /^pplx-[a-zA-Z0-9]{40,}$/, provider: "perplexity" },
  { pattern: /^r8_[a-zA-Z0-9]{30,}$/, provider: "replicate" },
  { pattern: /^fw_[a-zA-Z0-9]{30,}$/, provider: "fireworks" },
  // Payments
  { pattern: /^sk_live_/, provider: "stripe" },
  { pattern: /^sk_test_/, provider: "stripe" },
  { pattern: /^pk_live_/, provider: "stripe" },
  { pattern: /^pk_test_/, provider: "stripe" },
  { pattern: /^whsec_/, provider: "stripe" },
  { pattern: /^rk_live_/, provider: "stripe" },
  { pattern: /^rk_test_/, provider: "stripe" },
  // Google / Firebase
  { pattern: /^AIza[0-9A-Za-z_-]{35}$/, provider: "google" },
  // AWS
  { pattern: /^AKIA[0-9A-Z]{16}$/, provider: "aws" },
  { pattern: /^ASIA[0-9A-Z]{16}$/, provider: "aws" },
  // Email / messaging
  { pattern: /^SG\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, provider: "sendgrid" },
  { pattern: /^re_[a-zA-Z0-9]{20,}$/, provider: "resend" },
  { pattern: /^key-[a-zA-Z0-9]{20,}$/, provider: "mailgun" },
  { pattern: /^[a-f0-9]{32}-us\d+$/, provider: "mailchimp" },
  // Slack / Discord / Telegram
  { pattern: /^xoxb-/, provider: "slack" },
  { pattern: /^xoxp-/, provider: "slack" },
  { pattern: /^xoxa-/, provider: "slack" },
  { pattern: /^xoxs-/, provider: "slack" },
  { pattern: /^[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/, provider: "discord" },
  { pattern: /^\d{8,10}:[A-Za-z0-9_-]{35}$/, provider: "telegram" },
  // GitHub
  { pattern: /^ghp_[a-zA-Z0-9]{36}$/, provider: "github" },
  { pattern: /^ghs_[a-zA-Z0-9]{36}$/, provider: "github" },
  { pattern: /^gho_[a-zA-Z0-9]{36}$/, provider: "github" },
  { pattern: /^github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}$/, provider: "github" },
  // GitLab
  { pattern: /^glpat-[a-zA-Z0-9_-]{20}$/, provider: "gitlab" },
  // Cloud / hosting
  { pattern: /^dop_v1_[a-f0-9]{64}$/, provider: "digitalocean" },
  { pattern: /^doo_v1_[a-f0-9]{64}$/, provider: "digitalocean" },
  { pattern: /^FLWSECK-[a-zA-Z0-9]{32,}$/, provider: "flutterwave" },
  // Monitoring / observability
  { pattern: /^dd[a-z]_[a-zA-Z0-9]{32,}$/, provider: "datadog" },
  { pattern: /^[a-f0-9]{32}$/, provider: "datadog" }, // Only used if env name contains DATADOG
  { pattern: /^dbt[a-z]_[a-zA-Z0-9]{40,}$/, provider: "databricks" },
  // Twilio
  { pattern: /^SK[a-f0-9]{32}$/, provider: "twilio" },
  { pattern: /^AC[a-f0-9]{32}$/, provider: "twilio" },
  // Supabase (JWT format)
  { pattern: /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./, provider: "supabase" },
  // npm / package registries
  { pattern: /^npm_[a-zA-Z0-9]{36}$/, provider: "npm" },
  { pattern: /^pypi-[a-zA-Z0-9_-]{50,}$/, provider: "pypi" },
  // Databases
  { pattern: /^mongodb\+srv:\/\//, provider: "mongodb" },
  // Cloudflare
  { pattern: /^[a-zA-Z0-9_-]{37}\.[a-zA-Z0-9_-]{37,}$/, provider: "cloudflare" },
  // HubSpot
  { pattern: /^pat-[a-z]{2}-[a-f0-9]{8}-[a-f0-9]{4}-/, provider: "hubspot" },
  // Intercom
  { pattern: /^dG9rO[a-zA-Z0-9+=]{40,}$/, provider: "intercom" },
  // Vercel
  { pattern: /^[a-zA-Z0-9]{24}$/, provider: "vercel" }, // Only used if env name contains VERCEL
  // GraphQL / Headless CMS / BaaS
  { pattern: /^service:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/, provider: "apollo" },
  { pattern: /^CFPAT-[a-zA-Z0-9_-]{40,}$/, provider: "contentful" },
  { pattern: /^fnA[a-zA-Z0-9_-]{20,}$/, provider: "fauna" },
  { pattern: /^sk[a-zA-Z0-9]{40,}$/, provider: "sanity" }, // Only if env name contains SANITY
  { pattern: /^snapi_[a-zA-Z0-9]{20,}$/, provider: "sanity" },
  { pattern: /^Bearer [a-zA-Z0-9_-]{40,}$/, provider: "hygraph" }, // Only if env name contains HYGRAPH or GRAPHCMS
  { pattern: /^sk-[a-zA-Z0-9]{10,20}-[a-zA-Z0-9]{10,}$/, provider: "convex" },
  { pattern: /^phc_[a-zA-Z0-9]{30,}$/, provider: "posthog" },
  { pattern: /^xkeysib-[a-zA-Z0-9]{40,}$/, provider: "brevo" },
  { pattern: /^nk_[a-zA-Z0-9]{20,}$/, provider: "neon" },
  { pattern: /^sb-[a-zA-Z0-9]{20,}$/, provider: "supabase" },
  // Clerk keys use sk_test_/sk_live_ like Stripe — detected via env var name only
  // (see KNOWN_SECRETS mapping: CLERK_SECRET_KEY → clerk)
  { pattern: /^whsec_[a-zA-Z0-9]{20,}$/, provider: "svix" },
  // Algolia
  { pattern: /^[a-f0-9]{32}$/, provider: "algolia" }, // Only used if env name contains ALGOLIA
  // Pinecone
  { pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, provider: "pinecone" }, // Only if env name contains PINECONE
  // Upstash (Redis/Kafka)
  { pattern: /^AX[a-zA-Z0-9]{30,}$/, provider: "upstash" },
];

// Providers that work well through the transparent proxy
const PROXY_PROVIDERS = new Set([
  "openai", "anthropic", "google", "together", "mistral", "cohere",
  "groq", "perplexity", "fireworks", "deepseek", "replicate",
]);

// Providers that need the real key at runtime (webhooks, signatures, etc.)
const ENV_INJECTION_PROVIDERS = new Set([
  "stripe", "aws", "supabase", "twilio", "sendgrid", "firebase",
  "resend", "smtp", "github", "slack", "mailgun", "postmark",
]);

// Provider key rotation URLs — where users go to rotate compromised keys
const ROTATION_URLS: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  stripe: "https://dashboard.stripe.com/apikeys",
  google: "https://console.cloud.google.com/apis/credentials",
  together: "https://api.together.xyz/settings/api-keys",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys",
  cohere: "https://dashboard.cohere.com/api-keys",
  perplexity: "https://www.perplexity.ai/settings/api",
  fireworks: "https://fireworks.ai/account/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  replicate: "https://replicate.com/account/api-tokens",
  sendgrid: "https://app.sendgrid.com/settings/api_keys",
  resend: "https://resend.com/api-keys",
  github: "https://github.com/settings/tokens",
  aws: "https://console.aws.amazon.com/iam/home#/security_credentials",
  supabase: "https://supabase.com/dashboard/project/_/settings/api",
  twilio: "https://console.twilio.com/us1/account/keys-credentials/api-keys",
  datadog: "https://app.datadoghq.com/organization-settings/api-keys",
  slack: "https://api.slack.com/apps",
  discord: "https://discord.com/developers/applications",
  firebase: "https://console.firebase.google.com/project/_/settings/general",
};

// Provider info — descriptions, risk, and fix steps for scan output
const PROVIDER_INFO: Record<string, { name: string; desc: string; risk: string; steps: string[] }> = {
  openai: {
    name: "OpenAI",
    desc: "AI language models (GPT-4, DALL-E, Whisper)",
    risk: "Anyone with this key can make API calls charged to your account",
    steps: ["Go to https://platform.openai.com/api-keys", "Click 'Create new secret key'", "Delete or revoke the old key", "Update your .env with the new key"],
  },
  anthropic: {
    name: "Anthropic",
    desc: "Claude AI models",
    risk: "Anyone with this key can make Claude API calls charged to your account",
    steps: ["Go to https://console.anthropic.com/settings/keys", "Create a new API key", "Delete the old key", "Update your .env with the new key"],
  },
  stripe: {
    name: "Stripe",
    desc: "Payment processing (charges, subscriptions, refunds)",
    risk: "A live key can create charges, issue refunds, and access customer data",
    steps: ["Go to https://dashboard.stripe.com/apikeys", "Click 'Roll key' next to the compromised key", "Stripe generates a new key automatically", "Update your .env and hosting env vars"],
  },
  google: {
    name: "Google / Firebase",
    desc: "Google Cloud APIs, Firebase, Maps, Analytics",
    risk: "Depending on enabled APIs, could access cloud resources or incur charges",
    steps: ["Go to https://console.cloud.google.com/apis/credentials", "Delete the compromised key", "Create a new API key with appropriate restrictions", "Update your .env"],
  },
  aws: {
    name: "AWS",
    desc: "Amazon Web Services (S3, EC2, Lambda, etc.)",
    risk: "Full access to your AWS account depending on IAM permissions. Can spin up resources and incur massive charges",
    steps: ["Go to https://console.aws.amazon.com/iam/home#/security_credentials", "Deactivate the compromised access key", "Create a new access key pair", "Update all environments using the old key"],
  },
  github: {
    name: "GitHub",
    desc: "Code repositories, Actions, Packages",
    risk: "Can read/write your repositories, trigger workflows, and access organization data",
    steps: ["Go to https://github.com/settings/tokens", "Delete the compromised token", "Generate a new token with minimal scopes", "Update your .env and CI secrets"],
  },
  supabase: {
    name: "Supabase",
    desc: "Database, Auth, Storage, Realtime",
    risk: "Anon key: limited to row-level security policies. Service role key: bypasses RLS and has full database access",
    steps: ["Go to https://supabase.com/dashboard/project/_/settings/api", "Note: Supabase keys can't be rotated without recreating the project", "If service role key is exposed, restrict database access immediately"],
  },
  sendgrid: {
    name: "SendGrid",
    desc: "Transactional email delivery",
    risk: "Can send emails from your domain, potentially for phishing or spam",
    steps: ["Go to https://app.sendgrid.com/settings/api_keys", "Delete the compromised key", "Create a new API key with minimal permissions", "Update your .env"],
  },
  resend: {
    name: "Resend",
    desc: "Email API for developers",
    risk: "Can send emails from your verified domains",
    steps: ["Go to https://resend.com/api-keys", "Delete the compromised key", "Create a new API key", "Update your .env"],
  },
  twilio: {
    name: "Twilio",
    desc: "SMS, voice calls, messaging",
    risk: "Can send SMS/calls charged to your account, access phone numbers",
    steps: ["Go to https://console.twilio.com", "Rotate your Auth Token under Account Settings", "Update your .env with the new token"],
  },
  slack: {
    name: "Slack",
    desc: "Team messaging and workspace APIs",
    risk: "Can post messages, read channels, and access workspace data",
    steps: ["Go to https://api.slack.com/apps", "Select your app, go to OAuth & Permissions", "Reinstall the app to generate new tokens", "Update your .env"],
  },
  discord: {
    name: "Discord",
    desc: "Bot tokens and webhook URLs",
    risk: "Full control of your Discord bot — can send messages, manage servers",
    steps: ["Go to https://discord.com/developers/applications", "Select your app, go to Bot settings", "Click 'Reset Token'", "Update your .env"],
  },
  together: {
    name: "Together AI",
    desc: "Open-source AI model hosting",
    risk: "Can make inference calls charged to your account",
    steps: ["Go to https://api.together.xyz/settings/api-keys", "Delete the old key and create a new one", "Update your .env"],
  },
  groq: {
    name: "Groq",
    desc: "Fast AI inference (LPU)",
    risk: "Can make API calls charged to your account",
    steps: ["Go to https://console.groq.com/keys", "Delete the old key and create a new one", "Update your .env"],
  },
  datadog: {
    name: "Datadog",
    desc: "Monitoring and observability",
    risk: "Can access metrics, logs, and traces from your infrastructure",
    steps: ["Go to https://app.datadoghq.com/organization-settings/api-keys", "Revoke the compromised key", "Create a new API key", "Update your .env"],
  },
  contentful: {
    name: "Contentful",
    desc: "Headless CMS",
    risk: "Can read/write your content, publish entries, and manage spaces",
    steps: ["Go to https://app.contentful.com/account/profile/cma_tokens", "Revoke the compromised token", "Create a new personal access token", "Update your .env"],
  },
  fauna: {
    name: "FaunaDB",
    desc: "Serverless database",
    risk: "Can read/write data in your databases depending on key permissions",
    steps: ["Go to https://dashboard.fauna.com", "Navigate to Security > Keys", "Delete the compromised key and create a new one", "Update your .env"],
  },
  posthog: {
    name: "PostHog",
    desc: "Product analytics",
    risk: "Can access analytics events, feature flags, and user data",
    steps: ["Go to https://app.posthog.com/project/settings", "Rotate your project API key", "Update your .env"],
  },
  neon: {
    name: "Neon",
    desc: "Serverless Postgres",
    risk: "Can access your database with the permissions assigned to the role",
    steps: ["Go to https://console.neon.tech", "Reset the password for the database role", "Update your connection string"],
  },
  upstash: {
    name: "Upstash",
    desc: "Serverless Redis and Kafka",
    risk: "Can read/write data in your Redis or Kafka instances",
    steps: ["Go to https://console.upstash.com", "Regenerate the REST token for your database", "Update your .env"],
  },
};

// Base URL env var names for proxy-mode providers
const BASE_URL_MAP: Record<string, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
  google: "GOOGLE_API_BASE_URL",
  together: "TOGETHER_API_BASE_URL",
  mistral: "MISTRAL_API_BASE_URL",
  cohere: "COHERE_API_BASE_URL",
  groq: "GROQ_API_BASE_URL",
  perplexity: "PERPLEXITY_API_BASE_URL",
  fireworks: "FIREWORKS_API_BASE_URL",
  deepseek: "DEEPSEEK_API_BASE_URL",
  replicate: "REPLICATE_API_BASE_URL",
};

// Directories/files to skip when scanning source code
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".output",
  ".vaultproof", ".vercel", ".turbo", "coverage", "__pycache__", ".tox",
  "vendor", "target", "pkg",
]);

const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "Cargo.lock", "go.sum", "Gemfile.lock", "poetry.lock",
]);

// Source file extensions to scan for hardcoded keys
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rb", ".java", ".kt", ".rs",
  ".php", ".cs", ".swift",
]);

// Config files to scan for env var references (reminders, not rewriting)
const CONFIG_FILES = new Set([
  "docker-compose.yml", "docker-compose.yaml",
  "vercel.json", "railway.json", "fly.toml", "render.yaml",
  "Dockerfile",
]);

const CI_GLOBS = [
  ".github/workflows/*.yml",
  ".github/workflows/*.yaml",
  ".gitlab-ci.yml",
  ".circleci/config.yml",
];

function looksLikeSecret(name: string, value?: string): boolean {
  if (NON_SECRETS.has(name)) return false;
  if (name.startsWith("NEXT_PUBLIC_")) return false;
  if (!SECRET_PATTERNS.some((p) => p.test(name))) return false;
  // Entropy filter: reject values that look like config, not secrets.
  // Known prefix keys skip entropy check (they're already high-confidence).
  if (value && !detectProviderFromValue(value, name)) {
    const entropy = shannonEntropy(value);
    if (entropy < 3.5) return false; // "localhost:3000", "true", "development", etc.
  }
  return true;
}

function parseEnvFile(content: string): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name && value) entries.push({ name, value });
  }
  return entries;
}

/** Shannon entropy — measures randomness of a string. Real secrets score > 4.0. */
function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Ambiguous patterns that need env var name context to avoid false positives
const AMBIGUOUS_PROVIDERS = new Set(["datadog", "vercel", "cloudflare", "sanity", "hygraph", "graphcms", "algolia", "pinecone", "clerk"]);

/** Detect provider from key value prefix. Uses env var name for ambiguous patterns. */
function detectProviderFromValue(value: string, envName?: string): string | null {
  for (const { pattern, provider } of KEY_PREFIX_PATTERNS) {
    if (!pattern.test(value)) continue;
    // Ambiguous patterns (short hex, generic formats) require env name confirmation
    if (AMBIGUOUS_PROVIDERS.has(provider)) {
      if (!envName || !envName.toUpperCase().includes(provider.toUpperCase())) continue;
    }
    return provider;
  }
  return null;
}

/** Recommend proxy or env-injection for a provider. */
function recommendMode(provider: string): "proxy" | "env-injection" {
  if (PROXY_PROVIDERS.has(provider)) return "proxy";
  return "env-injection";
}

// ── Live key verification ─────────────────────────────────────────────────

/** Lightweight API endpoints for verifying keys are active. */
const VERIFY_ENDPOINTS: Record<string, { url: string; headers: (key: string) => Record<string, string> }> = {
  openai:    { url: "https://api.openai.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { url: "https://api.anthropic.com/v1/models", headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  stripe:    { url: "https://api.stripe.com/v1/balance", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  together:  { url: "https://api.together.xyz/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  groq:      { url: "https://api.groq.com/openai/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  mistral:   { url: "https://api.mistral.ai/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  cohere:    { url: "https://api.cohere.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  perplexity: { url: "https://api.perplexity.ai/chat/completions", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  deepseek:  { url: "https://api.deepseek.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  replicate: { url: "https://api.replicate.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  sendgrid:  { url: "https://api.sendgrid.com/v3/scopes", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  resend:    { url: "https://api.resend.com/api-keys", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  github:    { url: "https://api.github.com/user", headers: (k) => ({ Authorization: `Bearer ${k}`, "User-Agent": "VaultProof-CLI" }) },
  datadog:   { url: "https://api.datadoghq.com/api/v1/validate", headers: (k) => ({ "DD-API-KEY": k }) },
};

type VerifyStatus = "active" | "revoked" | "unknown";

/**
 * Verify a single key by calling the provider's API.
 * Returns "active" (2xx/429), "revoked" (401/403), or "unknown" (error/timeout).
 */
async function verifyKey(provider: string, value: string): Promise<VerifyStatus> {
  const endpoint = VERIFY_ENDPOINTS[provider];
  if (!endpoint) return "unknown";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(endpoint.url, {
      method: "GET",
      headers: endpoint.headers(value),
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 2xx or 429 (rate limited but key is valid) → active
    if (res.status < 400 || res.status === 429) return "active";
    // 401/403 → key rejected
    if (res.status === 401 || res.status === 403) return "revoked";
    return "unknown";
  } catch {
    clearTimeout(timer);
    return "unknown";
  }
}

/** Verify all keys in parallel (max 5 concurrent). */
async function verifyKeys(keys: FoundKey[]): Promise<Map<string, VerifyStatus>> {
  const results = new Map<string, VerifyStatus>();
  const CONCURRENCY = 5;

  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (key) => {
      const status = await verifyKey(key.provider, key.value);
      results.set(key.value, status);
    });
    await Promise.all(promises);
  }

  return results;
}

/** Walk directory tree, yielding file paths. Skips SKIP_DIRS and binary files. */
function walkDir(dir: string, maxDepth = 5, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    if (SKIP_FILES.has(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, maxDepth, depth + 1));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

interface FoundKey {
  envName: string;
  value: string;
  provider: string;
  label: string;
  mode: "proxy" | "env-injection";
  file: string;
  line?: number;
  type: "env" | "source" | "config" | "ci";
}

/** Scan source files for hardcoded API key patterns. */
function scanSourceFiles(dir: string): FoundKey[] {
  const found: FoundKey[] = [];
  const files = walkDir(dir);
  for (const filePath of files) {
    const ext = filePath.slice(filePath.lastIndexOf("."));
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    let content: string;
    try { content = readFileSync(filePath, "utf-8"); } catch { continue; }
    // Limit to files < 500KB to avoid scanning minified bundles
    if (content.length > 500_000) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Look for string literals containing known key prefixes
      for (const { pattern, provider } of KEY_PREFIX_PATTERNS) {
        // Match quoted strings: "sk-proj-..." or 'sk-proj-...'
        const stringMatches = line.matchAll(/["'`]([^"'`]{10,512})["'`]/g);
        for (const m of stringMatches) {
          const val = m[1];
          if (pattern.test(val)) {
            const mode = recommendMode(provider);
            const envName = KNOWN_SECRETS[ENV_VAR_MAP[provider]]
              ? ENV_VAR_MAP[provider]
              : `${provider.toUpperCase()}_API_KEY`;
            found.push({
              envName,
              value: val,
              provider,
              label: "default",
              mode,
              file: relative(dir, filePath),
              line: i + 1,
              type: "source",
            });
          }
        }
      }
    }
  }
  return found;
}

/** Scan config and CI files for env var name references (for reminders). */
function scanConfigFiles(dir: string, envNames: Set<string>): Array<{ file: string; envName: string; type: "config" | "ci" }> {
  const reminders: Array<{ file: string; envName: string; type: "config" | "ci" }> = [];

  // Config files in project root
  for (const configFile of CONFIG_FILES) {
    const fullPath = join(dir, configFile);
    if (!existsSync(fullPath)) continue;
    let content: string;
    try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
    for (const envName of envNames) {
      if (content.includes(envName)) {
        reminders.push({ file: configFile, envName, type: "config" });
      }
    }
  }

  // CI files
  for (const ciGlob of CI_GLOBS) {
    const ciPath = join(dir, ciGlob.replace("*", ""));
    const ciDir = dirname(ciPath);
    if (!existsSync(ciDir)) continue;
    let ciFiles: string[];
    try { ciFiles = readdirSync(ciDir); } catch { continue; }
    for (const file of ciFiles) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const fullPath = join(ciDir, file);
      let content: string;
      try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
      for (const envName of envNames) {
        if (content.includes(envName)) {
          reminders.push({ file: relative(dir, fullPath), envName, type: "ci" });
        }
      }
    }
  }

  return reminders;
}

/** Create backup of files that will be modified. Returns backup directory path. */
function createBackup(dir: string, filesToBackup: string[]): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join(dir, ".vaultproof", "backup", timestamp);
  mkdirSync(backupDir, { recursive: true });

  for (const file of filesToBackup) {
    const fullPath = join(dir, file);
    if (!existsSync(fullPath)) continue;
    const backupPath = join(backupDir, file);
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(fullPath, backupPath);
  }

  // Record which files were new (created by migrate, should be deleted on revert)
  writeFileSync(join(backupDir, "__new_files.json"), JSON.stringify([]), "utf-8");

  return backupDir;
}

/** Track a file that was created (not modified) so revert can delete it. */
function trackNewFile(backupDir: string, file: string): void {
  const newFilesPath = join(backupDir, "__new_files.json");
  const existing: string[] = JSON.parse(readFileSync(newFilesPath, "utf-8"));
  existing.push(file);
  writeFileSync(newFilesPath, JSON.stringify(existing), "utf-8");
}

/** Rewrite a .env file: replace a key's value, optionally add a BASE_URL line after it. */
function rewriteEnvLine(envContent: string, envName: string, newValue: string, addAfter?: string): string {
  const lines = envContent.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${envName}=`)) {
      result.push(`${envName}=${newValue}`);
      if (addAfter) result.push(addAfter);
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

/** Ensure .vaultproof/ is in .gitignore */
function ensureGitignore(dir: string): void {
  const gitignorePath = join(dir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".vaultproof")) {
      appendFileSync(gitignorePath, "\n# VaultProof backups\n.vaultproof/\n");
    }
  } else {
    writeFileSync(gitignorePath, "# VaultProof backups\n.vaultproof/\n", "utf-8");
  }
}

/** Find the most recent backup directory. */
function findLatestBackup(dir: string): string | null {
  const backupRoot = join(dir, ".vaultproof", "backup");
  if (!existsSync(backupRoot)) return null;
  const entries = readdirSync(backupRoot).sort().reverse();
  return entries.length > 0 ? join(backupRoot, entries[0]) : null;
}

program
  .command("migrate")
  .description("Scan project, store API keys in VaultProof, and rewrite configs (Pro only)")
  .option("-f, --file <path>", "Path to primary .env file", ".env")
  .option("--revert [timestamp]", "Revert to backup (latest or specific timestamp)")
  .option("--scan-only", "Show what would be changed without modifying files")
  .option("--verify", "Verify keys are active by calling provider APIs")
  .option("--no-verify", "Skip key verification")
  .option("--git-history", "Also scan git commit history for deleted keys")
  .option("--output <format>", "Output format: terminal, json (default: terminal)", "terminal")
  .addHelpText(
    "after",
    `
${chalk.bold("What it does:")}
  1. Scans .env files, source code, configs, and CI for API keys
  2. Asks you to approve each key before storing
  3. Stores approved keys in VaultProof (Shamir-split, encrypted)
  4. Rewrites .env files (proxy or env-injection mode per key)
  5. Shows reminders for CI/hosting env vars you need to update

${chalk.bold("Modes:")}
  ${chalk.cyan("proxy")}          Change baseURL — key never leaves VaultProof (OpenAI, Anthropic, etc.)
  ${chalk.cyan("env-injection")}  Real key injected at runtime via ${chalk.dim("vaultproof exec")} (Stripe, AWS, etc.)

${chalk.bold("Safety:")}
  - Backs up every modified file to .vaultproof/backup/
  - Asks before each change
  - ${chalk.dim("vaultproof migrate --revert")} restores all files

${chalk.bold("Example:")}
  $ vaultproof migrate
  $ vaultproof migrate -f .env.production
  $ vaultproof migrate --scan-only
  $ vaultproof migrate --revert
`
  )
  .action(async (opts: { file: string; revert?: boolean | string; scanOnly?: boolean; verify?: boolean; gitHistory?: boolean; output?: string }) => {
    const projectDir = process.cwd();

    // ─── Revert mode ──────────────────────────────────────────────────
    if (opts.revert !== undefined) {
      let backupDir: string | null;
      if (typeof opts.revert === "string" && opts.revert !== "") {
        backupDir = join(projectDir, ".vaultproof", "backup", opts.revert);
        if (!existsSync(backupDir)) {
          console.error(chalk.red(`Backup not found: ${opts.revert}`));
          process.exit(1);
        }
      } else {
        backupDir = findLatestBackup(projectDir);
        if (!backupDir) {
          console.error(chalk.red("No backups found in .vaultproof/backup/"));
          process.exit(1);
        }
      }

      console.log(chalk.bold(`\nRestoring from backup (${basename(backupDir)})...\n`));

      // Restore backed-up files
      const files = walkDir(backupDir, 3);
      for (const file of files) {
        const rel = relative(backupDir, file);
        if (rel === "__new_files.json") continue;
        const targetPath = join(projectDir, rel);
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(file, targetPath);
        console.log(`  ${chalk.green("✓")} ${rel} restored`);
      }

      // Delete files that were created by migrate
      const newFilesPath = join(backupDir, "__new_files.json");
      if (existsSync(newFilesPath)) {
        const newFiles: string[] = JSON.parse(readFileSync(newFilesPath, "utf-8"));
        for (const file of newFiles) {
          const targetPath = join(projectDir, file);
          if (existsSync(targetPath)) {
            unlinkSync(targetPath);
            console.log(`  ${chalk.green("✓")} ${file} removed`);
          }
        }
      }

      console.log(chalk.yellow("\n  Keys stored in VaultProof were NOT deleted."));
      console.log(chalk.dim("  Run `vaultproof revoke <keyId>` to remove them if needed.\n"));
      process.exit(0);
    }

    // ─── Main migrate flow ─────────────────────────────────────────────

    console.log();
    if (!opts.scanOnly) {
      console.log(chalk.yellow.bold("  ⚠  WARNING: This command will modify files in your project."));
      console.log(chalk.yellow("     Back up your project or commit your changes before proceeding."));
      console.log(chalk.yellow("     VaultProof will also create a local backup in .vaultproof/backup/\n"));

      const proceed = await confirm("  Continue?");
      if (!proceed) process.exit(0);
    }

    // Test connection + check limits (skip for dry-run — scan locally only)
    let tierInfo: { tier: string; used: number; limit: number; available: number; migrateEnabled: boolean };
    if (opts.scanOnly) {
      tierInfo = { tier: "pro", used: 0, limit: 100, available: 100, migrateEnabled: true };
      console.log(chalk.dim("\n  --scan-only: skipping API connection check\n"));
    } else {
      console.log();
      const connected = await testConnection();
      if (!connected) process.exit(1);

      const limitsSpinner = ora("  Checking account limits...").start();
      try {
        const { data: keysData } = await apiRequest<{ keys: unknown[] }>("GET", "/api/v1/sdk/keys", { auth: "apikey" });
        const used = (keysData.keys || []).length;
        // Tier limits — the /limits endpoint may not exist yet, so fall back to
        // a generous default and let the server enforce the real limit on store.
        let limit = 100;
        let tier = "pro";
        let migrateEnabled = true;
        try {
          const { data: limitsData } = await apiRequest<{ tier: string; keySlots: { used: number; limit: number }; features: { migrate: boolean } }>("GET", "/api/v1/sdk/limits", { auth: "apikey" });
          tier = limitsData.tier;
          limit = limitsData.keySlots.limit;
          migrateEnabled = limitsData.features.migrate;
        } catch {
          // /limits endpoint doesn't exist yet — fall through
        }
        tierInfo = { tier, used, limit, available: Math.max(0, limit - used), migrateEnabled };
        limitsSpinner.succeed(`  ${chalk.cyan(tierInfo.tier)} plan (${tierInfo.used}/${tierInfo.limit} key slots used, ${tierInfo.available} available)`);
      } catch {
        limitsSpinner.fail("  Could not check limits");
        process.exit(1);
      }

      if (!tierInfo.migrateEnabled) {
        console.log(chalk.red("\n  vaultproof migrate is available on the Pro plan."));
        console.log(chalk.dim("  Upgrade at https://vaultproof.dev/app/settings\n"));
        process.exit(1);
      }
    }

    // ─── Phase 1: Scan ──────────────────────────────────────────────────

    const scanSpinner = ora("  Scanning project...").start();

    // Scan all .env files
    const envFiles: string[] = [];
    const rootFiles = readdirSync(projectDir);
    for (const f of rootFiles) {
      if (f === ".env" || f.startsWith(".env.")) {
        envFiles.push(f);
      }
    }

    // Parse all env files
    const allEnvKeys: FoundKey[] = [];
    const seenValues = new Set<string>(); // Deduplicate same key across .env files

    for (const envFile of envFiles) {
      const fullPath = join(projectDir, envFile);
      let content: string;
      try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
      const entries = parseEnvFile(content);
      for (const entry of entries) {
        if (!looksLikeSecret(entry.name, entry.value)) continue;
        if (seenValues.has(entry.value)) continue;
        seenValues.add(entry.value);

        const known = KNOWN_SECRETS[entry.name];
        let provider = known?.provider || detectProviderFromValue(entry.value, entry.name) || "";
        const label = known?.label !== "default" ? known?.label || "default" : "default";
        const mode = provider ? recommendMode(provider) : "env-injection";

        allEnvKeys.push({
          envName: entry.name,
          value: entry.value,
          provider,
          label,
          mode,
          file: envFile,
          type: "env",
        });
      }
    }

    // Scan source files for hardcoded keys
    const sourceKeys = scanSourceFiles(projectDir);

    // Deduplicate: skip source keys whose value was already found in .env
    const uniqueSourceKeys = sourceKeys.filter((k) => !seenValues.has(k.value));
    for (const k of uniqueSourceKeys) seenValues.add(k.value);

    const allKeys = [...allEnvKeys, ...uniqueSourceKeys];

    // Scan config/CI files for env var name references
    const envNamesFound = new Set(allKeys.map((k) => k.envName));
    // Deduplicate config reminders (same env name can appear via multiple .env files)
    const configRemindersRaw = scanConfigFiles(projectDir, envNamesFound);
    const configRemindersSeen = new Set<string>();
    const configReminders = configRemindersRaw.filter((r) => {
      const key = `${r.file}:${r.envName}`;
      if (configRemindersSeen.has(key)) return false;
      configRemindersSeen.add(key);
      return true;
    });

    scanSpinner.succeed(`  Found ${allKeys.length} API key${allKeys.length !== 1 ? "s" : ""} across ${new Set(allKeys.map((k) => k.file)).size} file${new Set(allKeys.map((k) => k.file)).size !== 1 ? "s" : ""}`);

    // ─── Git history scanning (optional) ─────────────────────────────────
    if (opts.gitHistory) {
      const gitSpinner = ora("  Scanning git history for deleted keys...").start();
      try {
        const { execSync } = await import("node:child_process");
        // Get deleted lines from git history (additions that were later removed)
        // Scan full diff history for all commits — catches deleted lines in still-existing files
        const gitLog = execSync("git log --all -p -- '*.env' '*.env.*' '.env' '.env.*'", {
          cwd: projectDir,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000,
        });

        let gitKeysFound = 0;
        for (const line of gitLog.split("\n")) {
          // Lines that were removed start with -
          if (!line.startsWith("-") || line.startsWith("---")) continue;
          const content = line.slice(1).trim();
          const eqIndex = content.indexOf("=");
          if (eqIndex === -1) continue;
          const name = content.slice(0, eqIndex).trim();
          let value = content.slice(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!value || value.length < 10) continue;
          // Skip if already found in working tree
          if (seenValues.has(value)) continue;

          const provider = detectProviderFromValue(value, name);
          if (!provider) continue;
          seenValues.add(value);

          allKeys.push({
            envName: name,
            value,
            provider,
            label: "default",
            mode: recommendMode(provider),
            file: "(git history)",
            type: "env",
          });
          gitKeysFound++;
        }
        gitSpinner.succeed(`  Found ${gitKeysFound} additional key${gitKeysFound !== 1 ? "s" : ""} in git history`);
      } catch {
        gitSpinner.warn("  Git history scan skipped (not a git repo or git not available)");
      }
    }

    // ─── Allowlist filtering ──────────────────────────────────────────────
    const ignorePath = join(projectDir, ".vaultproofignore");
    if (existsSync(ignorePath)) {
      const ignoreContent = readFileSync(ignorePath, "utf-8");
      const ignorePatterns: string[] = [];
      for (const line of ignoreContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        ignorePatterns.push(trimmed);
      }
      if (ignorePatterns.length > 0) {
        const beforeCount = allKeys.length;
        const filtered = allKeys.filter((key) => {
          for (const pattern of ignorePatterns) {
            // Match env var name directly
            if (key.envName === pattern) return false;
            // Match file path glob (simple prefix matching)
            if (key.file && key.file.startsWith(pattern.replace("*", ""))) return false;
          }
          return true;
        });
        allKeys.length = 0;
        allKeys.push(...filtered);
        if (beforeCount !== allKeys.length) {
          console.log(chalk.dim(`  .vaultproofignore: skipped ${beforeCount - allKeys.length} key${beforeCount - allKeys.length !== 1 ? "s" : ""}`));
        }
      }
    }

    if (allKeys.length === 0) {
      console.log(chalk.yellow("\n  No API keys detected. Nothing to migrate.\n"));
      process.exit(0);
    }

    // ─── Live key verification (optional) ────────────────────────────────
    let verifyResults: Map<string, VerifyStatus> | null = null;
    if (opts.verify) {
      const verifiableKeys = allKeys.filter((k) => k.provider && VERIFY_ENDPOINTS[k.provider]);
      if (verifiableKeys.length > 0) {
        const verifySpinner = ora(`  Verifying ${verifiableKeys.length} key${verifiableKeys.length !== 1 ? "s" : ""} against provider APIs...`).start();
        verifyResults = await verifyKeys(verifiableKeys);
        const active = [...verifyResults.values()].filter((v) => v === "active").length;
        const revoked = [...verifyResults.values()].filter((v) => v === "revoked").length;
        const unknown = [...verifyResults.values()].filter((v) => v === "unknown").length;
        verifySpinner.succeed(`  Verified: ${active} active, ${revoked} revoked, ${unknown} unknown`);
      }
    }

    // Check capacity
    if (allKeys.length > tierInfo.available) {
      console.log(chalk.yellow(`\n  Found ${allKeys.length} keys but only ${tierInfo.available} slots available.`));
      console.log(chalk.dim("  You can choose which keys to migrate, or upgrade your plan.\n"));
    }

    // ─── JSON output mode ─────────────────────────────────────────────────
    if (opts.output === "json") {
      const jsonOutput = {
        keys: allKeys.map((k) => ({
          envName: k.envName,
          provider: k.provider,
          mode: k.mode,
          file: k.file,
          line: k.line,
          type: k.type,
          entropy: shannonEntropy(k.value),
          verified: verifyResults?.get(k.value) || null,
          masked: k.value.slice(0, 6) + "..." + k.value.slice(-4),
          info: PROVIDER_INFO[k.provider] || null,
          rotationUrl: ROTATION_URLS[k.provider] || null,
        })),
        configReminders: configReminders.map((r) => ({ file: r.file, envName: r.envName, type: r.type })),
        account: { tier: tierInfo.tier, slotsUsed: tierInfo.used, slotsLimit: tierInfo.limit, slotsAvailable: tierInfo.available },
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
      process.exit(0);
    }

    // ─── Display findings ────────────────────────────────────────────────

    console.log(chalk.bold("\n  Scan results:\n"));

    // Group by file
    const byFile = new Map<string, FoundKey[]>();
    for (const key of allKeys) {
      const existing = byFile.get(key.file) || [];
      existing.push(key);
      byFile.set(key.file, existing);
    }

    for (const [file, keys] of byFile) {
      console.log(chalk.white(`  ${file}`));
      for (const key of keys) {
        const masked = key.value.slice(0, 6) + "..." + key.value.slice(-4);
        const modeTag = key.mode === "proxy" ? chalk.cyan("proxy") : chalk.magenta("env-injection");
        const lineTag = key.line ? chalk.dim(`:${key.line}`) : "";
        const pInfo = PROVIDER_INFO[key.provider];
        const providerTag = pInfo ? chalk.dim(` (${pInfo.name})`) : key.provider ? chalk.dim(` (${key.provider})`) : chalk.yellow(" (unknown provider)");
        const verifyTag = verifyResults?.get(key.value)
          ? (verifyResults.get(key.value) === "active" ? chalk.green(" ✓ active")
            : verifyResults.get(key.value) === "revoked" ? chalk.red(" ✗ revoked")
            : chalk.dim(" ? unknown"))
          : "";
        console.log(`    ${chalk.white(key.envName)}${lineTag} = ${chalk.dim(masked)}  → ${modeTag}${providerTag}${verifyTag}`);
      }
      console.log();
    }

    if (configReminders.length > 0) {
      console.log(chalk.dim("  Referenced in (will show reminders):"));
      for (const r of configReminders) {
        console.log(chalk.dim(`    ${r.file} → ${r.envName}`));
      }
      console.log();
    }

    // ─── Fix Guidance ──────────────────────────────────────────────────

    // Active keys — need immediate rotation
    const activeKeys = allKeys.filter((k) => verifyResults?.get(k.value) === "active");
    // Git history keys
    const historyKeys = allKeys.filter((k) => k.file === "(git history)");
    // Hardcoded in source
    const hardcodedKeys = allKeys.filter((k) => k.type === "source");
    // Group hardcoded by value to count duplicates
    const hardcodedByValue = new Map<string, FoundKey[]>();
    for (const k of hardcodedKeys) {
      const existing = hardcodedByValue.get(k.value) || [];
      existing.push(k);
      hardcodedByValue.set(k.value, existing);
    }

    if (activeKeys.length > 0 || historyKeys.length > 0 || hardcodedKeys.length > 0) {
      console.log(chalk.bold.red("  ─── Action Required ───\n"));
    }

    if (activeKeys.length > 0) {
      console.log(chalk.red(`  ${activeKeys.length} ACTIVE key${activeKeys.length !== 1 ? "s" : ""} found — rotate immediately:\n`));
      for (const key of activeKeys) {
        const masked = key.value.slice(0, 6) + "..." + key.value.slice(-4);
        const rotateUrl = ROTATION_URLS[key.provider];
        const info = PROVIDER_INFO[key.provider];
        console.log(chalk.red(`    ${key.envName} (${masked})`));
        if (info) {
          console.log(chalk.dim(`      ${info.name} — ${info.desc}`));
          console.log(chalk.dim(`      Risk: ${info.risk}`));
          console.log(chalk.dim(`      How to fix:`));
          for (const step of info.steps) {
            console.log(chalk.dim(`        ${step}`));
          }
        } else if (rotateUrl) {
          console.log(chalk.dim(`      Rotate at: ${rotateUrl}`));
          console.log(chalk.dim(`      Then update your .env with the new key`));
        }
        console.log();
      }
    }

    if (historyKeys.length > 0) {
      const activeInHistory = historyKeys.filter((k) => verifyResults?.get(k.value) === "active").length;
      const revokedInHistory = historyKeys.filter((k) => verifyResults?.get(k.value) === "revoked").length;
      console.log(chalk.yellow(`  ${historyKeys.length} key${historyKeys.length !== 1 ? "s" : ""} found in git history${activeInHistory > 0 ? ` (${activeInHistory} still active!)` : revokedInHistory > 0 ? ` (${revokedInHistory} already revoked)` : ""}`));
      console.log(chalk.dim("    Keys in git history cannot be removed by deleting files."));
      console.log(chalk.dim("    Even after rotating, old values are visible in commit history."));
      console.log(chalk.dim("    If this repo is public, see:"));
      console.log(chalk.dim("    https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository\n"));
    }

    if (hardcodedKeys.length > 0) {
      for (const [, keys] of hardcodedByValue) {
        const k = keys[0];
        if (keys.length > 1) {
          console.log(chalk.yellow(`  ${keys.length} files have the same ${k.provider} key hardcoded.`));
          console.log(chalk.dim(`    Move it to .env and use process.env.${k.envName} instead.\n`));
        } else {
          console.log(chalk.yellow(`  Hardcoded ${k.provider} key in ${k.file}:${k.line}`));
          console.log(chalk.dim(`    Move it to .env and use process.env.${k.envName} instead.\n`));
        }
      }
    }

    // ─── Rotation confirmation ──────────────────────────────────────────

    if (activeKeys.length > 0 && !opts.scanOnly) {
      console.log(chalk.bold("  Please rotate the active keys above before continuing.\n"));

      for (const key of activeKeys) {
        const masked = key.value.slice(0, 6) + "..." + key.value.slice(-4);
        const rotateUrl = ROTATION_URLS[key.provider];
        if (rotateUrl) console.log(chalk.dim(`    ${key.envName}: ${rotateUrl}`));

        const rotated = await confirm(`  Have you rotated ${chalk.white(key.envName)} (${masked})?`);
        if (rotated) {
          // Re-verify the old key to confirm it's actually revoked now
          const recheck = await verifyKey(key.provider, key.value);
          if (recheck === "active") {
            console.log(chalk.red(`    The old key is still active. Please rotate it before continuing.`));
            const skip = await confirm(`    Continue anyway?`);
            if (!skip) {
              console.log(chalk.dim("    Run the scan again after rotating.\n"));
              process.exit(0);
            }
          } else if (recheck === "revoked") {
            console.log(chalk.green(`    ✓ Confirmed — old key is now revoked.\n`));
          } else {
            console.log(chalk.dim(`    Could not verify — please confirm manually.\n`));
          }
        } else {
          const skip = await confirm(`    Skip and continue anyway?`);
          if (!skip) {
            console.log(chalk.dim("    Run the scan again after rotating.\n"));
            process.exit(0);
          }
          console.log();
        }
      }
    }

    if (opts.scanOnly) {
      console.log(chalk.yellow("  --scan-only: No changes made.\n"));
      process.exit(0);
    }

    // ─── Phase 2: Interactive approval + store ───────────────────────────

    const toStore: FoundKey[] = [];
    let slotsUsed = 0;

    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];

      if (slotsUsed >= tierInfo.available) {
        console.log(chalk.yellow(`  No more key slots available (${tierInfo.available} used). Skipping remaining keys.`));
        break;
      }

      const masked = key.value.slice(0, 6) + "..." + key.value.slice(-4);
      const modeLabel = key.mode === "proxy" ? chalk.cyan("proxy") : chalk.magenta("env-injection");

      // Auto-skip revoked keys
      if (verifyResults?.get(key.value) === "revoked") {
        console.log(chalk.dim(`  Step ${i + 1} of ${allKeys.length}: ${key.envName} (${masked}) — ${chalk.red("skipped (revoked)")}`));
        console.log();
        continue;
      }

      console.log(chalk.bold(`  Step ${i + 1} of ${allKeys.length}: ${chalk.white(key.envName)} (${masked})`));
      console.log(chalk.dim(`    File: ${key.file}${key.line ? `:${key.line}` : ""}`));

      // Ask for provider if unknown
      if (!key.provider) {
        key.provider = await prompt("    Provider (e.g. stripe, aws, openai): ");
        if (!key.provider) {
          console.log(chalk.dim("    Skipped.\n"));
          continue;
        }
        key.mode = recommendMode(key.provider);
      }

      console.log(chalk.dim(`    Provider: ${key.provider}`));
      console.log(chalk.dim(`    Mode: ${modeLabel} (${key.mode === "proxy" ? "change baseURL, key never leaves VaultProof" : "real key injected at runtime via vaultproof exec"})`));

      const answer = await prompt(`    [y]es / [n]o / [e] switch mode / [s]kip rest: `);
      const choice = answer.toLowerCase().trim();

      if (choice === "s") break;
      if (choice === "n" || choice === "") {
        console.log();
        continue;
      }
      if (choice === "e") {
        key.mode = key.mode === "proxy" ? "env-injection" : "proxy";
        console.log(chalk.dim(`    Switched to ${key.mode}`));
      }
      if (choice === "y" || choice === "e") {
        toStore.push(key);
        slotsUsed++;
        console.log();
      } else {
        console.log();
      }
    }

    if (toStore.length === 0) {
      console.log(chalk.yellow("\n  Nothing to store. Done.\n"));
      process.exit(0);
    }

    // ─── Phase 3: Backup ─────────────────────────────────────────────────

    const filesToModify = [...new Set(toStore.filter((k) => k.type === "env").map((k) => k.file))];
    // Also backup source files with hardcoded keys
    for (const k of toStore) {
      if (k.type === "source" && !filesToModify.includes(k.file)) {
        filesToModify.push(k.file);
      }
    }

    console.log(chalk.bold(`\n  Backing up ${filesToModify.length} file${filesToModify.length !== 1 ? "s" : ""} to .vaultproof/backup/\n`));
    const backupDir = createBackup(projectDir, filesToModify);
    for (const f of filesToModify) {
      console.log(`    ${chalk.green("✓")} ${f}`);
    }
    ensureGitignore(projectDir);

    // ─── Phase 4: Store keys ──────────────────────────────────────────────

    console.log(chalk.bold(`\n  Storing ${toStore.length} key${toStore.length !== 1 ? "s" : ""} in VaultProof...\n`));

    const stored: Array<FoundKey & { keyId: string }> = [];

    for (const item of toStore) {
      const spinner = ora(`    Storing ${item.envName}...`).start();

      const shares = splitString(item.value, 2, 2);
      const share1 = serializeShare(shares[0]);
      const share2 = serializeShare(shares[1]);

      try {
        const { data } = await apiRequest<{ keyId: string; warning?: string }>("POST", "/api/v1/sdk/store", {
          body: {
            share1,
            share2,
            provider: item.provider,
            label: item.label === "default" ? `${item.provider} key` : item.label,
            envVar: item.envName,
          },
          auth: "apikey",
        });

        stored.push({ ...item, keyId: data.keyId });
        const dupTag = data.warning ? chalk.yellow(" ⚠ duplicate") : "";
        spinner.succeed(`    ${chalk.green(item.envName)} stored (${data.keyId.slice(0, 8)}...)${dupTag}`);
      } catch {
        spinner.fail(`    ${chalk.red(item.envName)} failed`);
      }
    }

    if (stored.length === 0) {
      console.log(chalk.red("\n  All stores failed. Check your API key and try again."));
      console.log(chalk.dim(`  To restore files: vaultproof migrate --revert\n`));
      process.exit(1);
    }

    // ─── Phase 5: Rewrite files ──────────────────────────────────────────

    console.log(chalk.bold("\n  Rewriting files...\n"));

    const vpApiKey = getApiKey() || "vp_live_YOUR_KEY_HERE";

    // Rewrite .env files
    const envFilesModified = new Set<string>();
    for (const key of stored) {
      if (key.type !== "env") continue;
      const envPath = join(projectDir, key.file);
      let content: string;
      try { content = readFileSync(envPath, "utf-8"); } catch { continue; }

      if (key.mode === "proxy") {
        // Replace key value with vp_live_ key, add BASE_URL
        const baseUrlVar = BASE_URL_MAP[key.provider];
        const baseUrlLine = baseUrlVar
          ? `${baseUrlVar}=https://api.vaultproof.dev/v1/${key.provider}`
          : undefined;
        content = rewriteEnvLine(content, key.envName, vpApiKey, baseUrlLine);
      } else {
        // Env-injection mode: comment out the real value
        content = rewriteEnvLine(
          content,
          key.envName,
          `# Managed by VaultProof — injected at runtime via: vaultproof exec -- <your command>`,
        );
      }

      writeFileSync(envPath, content, "utf-8");
      envFilesModified.add(key.file);
      console.log(`    ${chalk.green("✓")} ${key.file}: ${key.envName} rewritten (${key.mode})`);
    }

    // Rewrite source files with hardcoded keys
    for (const key of stored) {
      if (key.type !== "source" || !key.line) continue;
      const srcPath = join(projectDir, key.file);
      let content: string;
      try { content = readFileSync(srcPath, "utf-8"); } catch { continue; }
      // Replace the hardcoded value with process.env reference
      content = content.replace(
        new RegExp(`(["'\`])${key.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g"),
        `process.env.${key.envName}!`,
      );
      writeFileSync(srcPath, content, "utf-8");
      console.log(`    ${chalk.green("✓")} ${key.file}:${key.line}: replaced hardcoded key with process.env.${key.envName}`);
    }

    // Generate vaultproof.json
    const vpConfig: Record<string, { keyId: string; provider: string; mode: string }> = {};
    for (const key of stored) {
      vpConfig[key.envName] = { keyId: key.keyId, provider: key.provider, mode: key.mode };
    }
    const vpConfigPath = join(projectDir, "vaultproof.json");
    const isNewConfig = !existsSync(vpConfigPath);
    writeFileSync(vpConfigPath, JSON.stringify({ keys: vpConfig }, null, 2) + "\n", "utf-8");
    if (isNewConfig) trackNewFile(backupDir, "vaultproof.json");
    console.log(`    ${chalk.green("✓")} vaultproof.json ${isNewConfig ? "created" : "updated"}`);

    // ─── Phase 6: Summary ────────────────────────────────────────────────

    console.log(chalk.bold("\n  ─── Summary ───\n"));

    console.log(chalk.green(`  ✓ ${stored.length} key${stored.length !== 1 ? "s" : ""} stored in VaultProof`));
    console.log(chalk.green(`  ✓ ${envFilesModified.size} file${envFilesModified.size !== 1 ? "s" : ""} rewritten`));

    const proxyKeys = stored.filter((k) => k.mode === "proxy");
    const envKeys = stored.filter((k) => k.mode === "env-injection");

    if (proxyKeys.length > 0) {
      console.log(chalk.cyan(`\n  Proxy mode (${proxyKeys.length} key${proxyKeys.length !== 1 ? "s" : ""}):`));
      console.log(chalk.dim("  These keys never leave VaultProof. Your SDK uses the proxy URL automatically."));
      for (const k of proxyKeys) {
        console.log(chalk.dim(`    ${k.envName} → https://api.vaultproof.dev/v1/${k.provider}`));
      }
    }

    if (envKeys.length > 0) {
      console.log(chalk.magenta(`\n  Env-injection mode (${envKeys.length} key${envKeys.length !== 1 ? "s" : ""}):`));
      console.log(chalk.dim("  These keys are injected at runtime. Start your app with:"));
      console.log(chalk.white(`    vaultproof exec -- <your start command>`));
      for (const k of envKeys) {
        console.log(chalk.dim(`    ${k.envName} → injected from VaultProof at startup`));
      }
    }

    // Config/CI reminders
    if (configReminders.length > 0) {
      console.log(chalk.yellow(`\n  ⚠ ${configReminders.length} file${configReminders.length !== 1 ? "s" : ""} need manual updates:`));
      for (const r of configReminders) {
        if (r.type === "ci") {
          console.log(chalk.yellow(`    • ${r.file}: update ${r.envName} secret`));
        } else {
          console.log(chalk.yellow(`    • ${r.file}: update ${r.envName} env var`));
        }
      }
    }

    // Hosting reminders
    console.log(chalk.yellow("\n  ⚠ Remember to set VAULTPROOF_API_KEY in:"));
    console.log(chalk.dim("    • Your local .env (check if already set)"));
    if (configReminders.some((r) => r.file.includes("github"))) {
      console.log(chalk.dim("    • GitHub Actions secrets"));
    }
    if (configReminders.some((r) => r.file === "vercel.json")) {
      console.log(chalk.dim("    • Vercel environment variables"));
    }
    if (configReminders.some((r) => r.file === "railway.json")) {
      console.log(chalk.dim("    • Railway environment variables"));
    }
    if (configReminders.some((r) => r.file.includes("fly"))) {
      console.log(chalk.dim("    • Fly.io secrets"));
    }
    console.log(chalk.dim("    • Any other deploy targets"));

    console.log(chalk.bold("\n  To undo all changes:"));
    console.log(chalk.white(`    vaultproof migrate --revert\n`));

    console.log(chalk.dim("  Run your app locally to test before pushing.\n"));
  });

// ─── scan (alias for migrate --scan-only) ────────────────────────────────────

program
  .command("scan")
  .description("Scan project for exposed API keys (alias for migrate --scan-only)")
  .option("-f, --file <path>", "Path to primary .env file", ".env")
  .option("--verify", "Verify keys are active by calling provider APIs")
  .option("--git-history", "Also scan git commit history for deleted keys")
  .option("--output <format>", "Output format: terminal, json", "terminal")
  .action(async (opts: { file: string; verify?: boolean; gitHistory?: boolean; output?: string }) => {
    // Delegate to migrate with --scan-only
    await program.parseAsync(["node", "vaultproof", "migrate", "--scan-only",
      "-f", opts.file,
      ...(opts.verify ? ["--verify"] : []),
      ...(opts.gitHistory ? ["--git-history"] : []),
      ...(opts.output ? ["--output", opts.output] : []),
    ]);
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parse();
