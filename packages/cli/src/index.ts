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
import { apiRequest, apiRequestNoAuth } from "./api.js";
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
  .version("1.0.0", "-v, --version")
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
  .description("Log in to your VaultProof account")
  .option("-e, --email <email>", "Email address (skips prompt)")
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof login
  $ vaultproof login -e you@example.com

${chalk.bold("Notes:")}
  Stores session token at ~/.vaultproof/config.json
  Token expires after 7 days — run login again to refresh.
`
  )
  .action(async (opts: { email?: string }) => {
    const email = opts.email || (await prompt("Email: "));
    const password = await promptHidden("Password: ");

    const spinner = ora("Logging in...").start();

    const { data } = await apiRequestNoAuth<{
      token: string;
      email: string;
    }>("POST", "/api/v1/auth/login", { email, password });

    updateConfig({ token: data.token, email: data.email ?? email });

    spinner.succeed(
      chalk.green(`Logged in as ${chalk.bold(data.email ?? email)}`)
    );
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
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  $ vaultproof store -p openai
  $ vaultproof store -p anthropic -l "Production key"
  $ vaultproof store --provider google --label "Vertex AI"

${chalk.bold("How it works:")}
  1. You paste your API key (hidden input)
  2. Key is Shamir-split locally into 2 shares
  3. Both shares are sent encrypted with different keys
  4. The full API key NEVER leaves your machine

${chalk.bold("Requires:")} VAULTPROOF_API_KEY environment variable
`
  )
  .action(async (opts: { provider: string; label?: string }) => {
    const apiKey = await promptHidden("API Key: ");

    if (!apiKey) {
      console.error(chalk.red("API key cannot be empty."));
      process.exit(1);
    }

    if (apiKey.length < 8) {
      console.error(chalk.red("API key seems too short. Check your input."));
      process.exit(1);
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
    }>("POST", "/api/v1/sdk/store", {
      body: {
        provider: opts.provider,
        label: opts.label ?? "",
        share1,
        share2,
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
    console.log(
      chalk.dim(
        "  Key was Shamir-split locally. Server never saw the full key."
      )
    );
    console.log(
      chalk.dim(`  Use ${chalk.reset("vaultproof proxy -k " + data.id.slice(0, 8))} to make API calls.`)
    );
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

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parse();
