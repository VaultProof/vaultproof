#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  readConfig,
  updateConfig,
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
  .description("VaultProof CLI — manage API keys from the terminal")
  .version("1.0.0");

// ─── login ───────────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Log in to your VaultProof account")
  .action(async () => {
    const email = await prompt("Email: ");
    const password = await promptHidden("Password: ");

    const spinner = ora("Logging in...").start();

    const { data } = await apiRequestNoAuth<{
      token: string;
      email: string;
    }>("POST", "/api/v1/auth/login", { email, password });

    updateConfig({ token: data.token, email: data.email ?? email });

    spinner.succeed(chalk.green(`Logged in as ${chalk.bold(data.email ?? email)}`));
  });

// ─── register ────────────────────────────────────────────────────────────────

program
  .command("register")
  .description("Create a new VaultProof account")
  .action(async () => {
    const email = await prompt("Email: ");
    const password = await promptHidden("Password: ");
    const confirmPassword = await promptHidden("Confirm password: ");

    if (password !== confirmPassword) {
      console.error(chalk.red("Passwords do not match."));
      process.exit(1);
    }

    const spinner = ora("Creating account...").start();

    const { data } = await apiRequestNoAuth<{
      token: string;
      email: string;
    }>("POST", "/api/v1/auth/register", { email, password });

    updateConfig({ token: data.token, email: data.email ?? email });

    spinner.succeed(
      chalk.green(`Account created. Logged in as ${chalk.bold(data.email ?? email)}`)
    );
  });

// ─── whoami ──────────────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("Show the current authenticated user")
  .action(async () => {
    const spinner = ora("Fetching user info...").start();

    const { data } = await apiRequest<{
      email: string;
      createdAt: string;
    }>("GET", "/api/v1/auth/me", { auth: "jwt" });

    spinner.stop();

    console.log(chalk.bold("Email:   ") + data.email);
    console.log(
      chalk.bold("Created: ") + new Date(data.createdAt).toLocaleDateString()
    );
  });

// ─── keys ────────────────────────────────────────────────────────────────────

program
  .command("keys")
  .description("List stored API keys")
  .action(async () => {
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
      console.log(chalk.dim("No keys stored yet. Use `vaultproof store` to add one."));
      return;
    }

    // Print table header
    const idW = 12;
    const provW = 12;
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
  });

// ─── store ───────────────────────────────────────────────────────────────────

program
  .command("store")
  .description("Store a new API key with Shamir splitting")
  .requiredOption("--provider <provider>", "API provider (e.g., openai, anthropic)")
  .option("--label <label>", "Label for this key")
  .action(async (opts: { provider: string; label?: string }) => {
    const apiKey = await promptHidden("API Key: ");

    if (!apiKey) {
      console.error(chalk.red("API key cannot be empty."));
      process.exit(1);
    }

    const spinner = ora("Splitting key with Shamir secret sharing...").start();

    // 2-of-2 split: share1 goes to vault, share2 goes to vault (encrypted differently)
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

    const truncatedId =
      data.id.length > 8 ? data.id.slice(0, 8) + "..." : data.id;
    spinner.succeed(
      chalk.green(
        `Key stored: ${truncatedId} (${data.provider}${data.label ? " / " + data.label : ""})`
      )
    );
    console.log(
      chalk.dim("  Key was Shamir-split locally. Server never saw the full key.")
    );
  });

// ─── proxy ───────────────────────────────────────────────────────────────────

program
  .command("proxy")
  .description("Make a proxied API call through VaultProof")
  .requiredOption("--key <keyId>", "Key ID to use")
  .requiredOption("--path <path>", "API path to call")
  .option("--method <method>", "HTTP method", "GET")
  .option("--body <json>", "Request body as JSON")
  .action(
    async (opts: {
      key: string;
      path: string;
      method: string;
      body?: string;
    }) => {
      let parsedBody: unknown = undefined;
      if (opts.body) {
        try {
          parsedBody = JSON.parse(opts.body);
        } catch {
          console.error(chalk.red("Invalid JSON body."));
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
  .description("Revoke a stored API key")
  .action(async (keyId: string) => {
    const yes = await confirm(
      `Are you sure you want to revoke key ${chalk.bold(keyId)}?`
    );
    if (!yes) {
      console.log(chalk.dim("Aborted."));
      return;
    }

    const spinner = ora("Revoking key...").start();

    await apiRequest("POST", "/api/v1/sdk/revoke", {
      body: { keyId },
      auth: "apikey",
    });

    spinner.succeed(chalk.green(`Key ${keyId} revoked.`));
  });

// ─── dev-key ─────────────────────────────────────────────────────────────────

const devKey = program
  .command("dev-key")
  .description("Manage developer API keys");

devKey
  .command("create")
  .description("Create a new developer API key")
  .option("--label <label>", "Label for this key", "default")
  .option("--mode <mode>", "Key mode: live or test", "live")
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

    spinner.succeed(chalk.green("Developer API key created:"));
    console.log(`  ${chalk.cyan.bold(data.key)}`);
    console.log(
      chalk.yellow("  Warning: Save this key — you won't see it again!")
    );

    const writeEnv = await confirm("\nWrite to .env file in current directory?");
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
  .description("List developer API keys")
  .action(async () => {
    const spinner = ora("Fetching developer keys...").start();

    const { data } = await apiRequest<{
      keys: Array<{
        id: string;
        maskedKey: string;
        label: string;
        mode: string;
        createdAt: string;
      }>;
    }>("GET", "/api/v1/dev-keys", { auth: "jwt" });

    spinner.stop();

    if (!data.keys || data.keys.length === 0) {
      console.log(
        chalk.dim(
          "No developer keys yet. Use `vaultproof dev-key create` to make one."
        )
      );
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

    for (const k of data.keys) {
      const id = k.id.length > 8 ? k.id.slice(0, 8) : k.id;
      const created = timeAgo(new Date(k.createdAt));
      console.log(
        pad(id, idW) +
          pad(k.maskedKey, keyW) +
          pad(k.label, labelW) +
          pad(k.mode, modeW) +
          pad(created, createdW)
      );
    }
  });

devKey
  .command("revoke <id>")
  .description("Revoke a developer API key")
  .action(async (id: string) => {
    const yes = await confirm(
      `Are you sure you want to revoke developer key ${chalk.bold(id)}?`
    );
    if (!yes) {
      console.log(chalk.dim("Aborted."));
      return;
    }

    const spinner = ora("Revoking developer key...").start();

    await apiRequest("POST", "/api/v1/dev-keys/revoke", {
      body: { id },
      auth: "jwt",
    });

    spinner.succeed(chalk.green(`Developer key ${id} revoked.`));
  });

// ─── logs ────────────────────────────────────────────────────────────────────

program
  .command("logs")
  .description("View recent access logs")
  .option("--key <keyId>", "Filter by key ID")
  .option("--limit <n>", "Number of log entries", "20")
  .action(async (opts: { key?: string; limit: string }) => {
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
      console.log(chalk.dim("No logs found."));
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

    for (const log of data.logs) {
      const time = new Date(log.timestamp).toLocaleString();
      const keyTrunc =
        log.keyId.length > 8 ? log.keyId.slice(0, 8) : log.keyId;
      const statusColor =
        log.status >= 200 && log.status < 300
          ? chalk.green
          : log.status >= 400
            ? chalk.red
            : chalk.yellow;

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

program
  .command("config")
  .description("Show current CLI configuration")
  .action(() => {
    const cfg = readConfig();
    const apiUrl = getApiUrl();
    const token = getToken();
    const devApiKey = getApiKey();

    console.log(chalk.bold("VaultProof CLI Configuration\n"));
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
          ? chalk.green(
              devApiKey.slice(0, 12) + "..." + devApiKey.slice(-4)
            )
          : chalk.dim("Not set (VAULTPROOF_API_KEY)"))
    );
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
