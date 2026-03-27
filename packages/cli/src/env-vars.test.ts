import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEnvVar, ENV_VAR_MAP } from "./env-vars.js";

describe("resolveEnvVar", () => {
  // --- Custom --var flag always wins ---

  it("custom var flag overrides everything", () => {
    const result = resolveEnvVar(
      { provider: "openai", label: "main" },
      [{ provider: "openai", label: "main" }],
      "MY_CUSTOM_VAR"
    );
    assert.equal(result, "MY_CUSTOM_VAR");
  });

  // --- Stored envVar takes priority over auto-resolution ---

  it("stored envVar wins over label map and provider map", () => {
    const result = resolveEnvVar(
      { provider: "supabase", label: "anon", envVar: "MY_SUPA_KEY" },
      [{ provider: "supabase", label: "anon" }]
    );
    assert.equal(result, "MY_SUPA_KEY");
  });

  // --- Single key for a provider uses standard name ---

  it("single openai key → OPENAI_API_KEY", () => {
    const result = resolveEnvVar(
      { provider: "openai", label: "main" },
      [{ provider: "openai", label: "main" }]
    );
    assert.equal(result, "OPENAI_API_KEY");
  });

  it("single anthropic key → ANTHROPIC_API_KEY", () => {
    const result = resolveEnvVar(
      { provider: "anthropic", label: "prod" },
      [{ provider: "anthropic", label: "prod" }]
    );
    assert.equal(result, "ANTHROPIC_API_KEY");
  });

  it("single unknown provider → PROVIDER_API_KEY", () => {
    const result = resolveEnvVar(
      { provider: "acme", label: "default" },
      [{ provider: "acme", label: "default" }]
    );
    assert.equal(result, "ACME_API_KEY");
  });

  // --- Known label mappings (multi-key providers) ---

  it("supabase/anon → SUPABASE_ANON_KEY", () => {
    const allKeys = [
      { provider: "supabase", label: "anon" },
      { provider: "supabase", label: "service_role" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "supabase", label: "anon" }, allKeys),
      "SUPABASE_ANON_KEY"
    );
  });

  it("supabase/service_role → SUPABASE_SERVICE_ROLE_KEY", () => {
    const allKeys = [
      { provider: "supabase", label: "anon" },
      { provider: "supabase", label: "service_role" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "supabase", label: "service_role" }, allKeys),
      "SUPABASE_SERVICE_ROLE_KEY"
    );
  });

  it("stripe/secret → STRIPE_SECRET_KEY", () => {
    const allKeys = [
      { provider: "stripe", label: "secret" },
      { provider: "stripe", label: "publishable" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "stripe", label: "secret" }, allKeys),
      "STRIPE_SECRET_KEY"
    );
  });

  it("stripe/publishable → STRIPE_PUBLISHABLE_KEY", () => {
    const allKeys = [
      { provider: "stripe", label: "secret" },
      { provider: "stripe", label: "publishable" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "stripe", label: "publishable" }, allKeys),
      "STRIPE_PUBLISHABLE_KEY"
    );
  });

  it("stripe/webhook_secret → STRIPE_WEBHOOK_SECRET", () => {
    const allKeys = [
      { provider: "stripe", label: "secret" },
      { provider: "stripe", label: "webhook_secret" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "stripe", label: "webhook_secret" }, allKeys),
      "STRIPE_WEBHOOK_SECRET"
    );
  });

  it("aws/access_key → AWS_ACCESS_KEY_ID", () => {
    const allKeys = [
      { provider: "aws", label: "access_key" },
      { provider: "aws", label: "secret_key" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "aws", label: "access_key" }, allKeys),
      "AWS_ACCESS_KEY_ID"
    );
  });

  it("aws/secret_key → AWS_SECRET_ACCESS_KEY", () => {
    const allKeys = [
      { provider: "aws", label: "access_key" },
      { provider: "aws", label: "secret_key" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "aws", label: "secret_key" }, allKeys),
      "AWS_SECRET_ACCESS_KEY"
    );
  });

  it("twilio/auth_token → TWILIO_AUTH_TOKEN", () => {
    const allKeys = [
      { provider: "twilio", label: "auth_token" },
      { provider: "twilio", label: "account_sid" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "twilio", label: "auth_token" }, allKeys),
      "TWILIO_AUTH_TOKEN"
    );
  });

  it("twilio/account_sid → TWILIO_ACCOUNT_SID", () => {
    const allKeys = [
      { provider: "twilio", label: "auth_token" },
      { provider: "twilio", label: "account_sid" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "twilio", label: "account_sid" }, allKeys),
      "TWILIO_ACCOUNT_SID"
    );
  });

  // --- Label normalization (spaces and hyphens become underscores) ---

  it("normalizes label with spaces: 'anon key' → SUPABASE_ANON_KEY", () => {
    const allKeys = [
      { provider: "supabase", label: "anon key" },
      { provider: "supabase", label: "service role" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "supabase", label: "anon key" }, allKeys),
      "SUPABASE_ANON_KEY"
    );
  });

  it("normalizes label with hyphens: 'secret-key' → STRIPE_SECRET_KEY", () => {
    const allKeys = [
      { provider: "stripe", label: "secret-key" },
      { provider: "stripe", label: "publishable" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "stripe", label: "secret-key" }, allKeys),
      "STRIPE_SECRET_KEY"
    );
  });

  // --- Multiple keys, unknown labels → PROVIDER_LABEL fallback ---

  it("two openai keys with unknown labels → OPENAI_GPT4 / OPENAI_DALLE", () => {
    const allKeys = [
      { provider: "openai", label: "gpt4" },
      { provider: "openai", label: "dalle" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "openai", label: "gpt4" }, allKeys),
      "OPENAI_GPT4"
    );
    assert.equal(
      resolveEnvVar({ provider: "openai", label: "dalle" }, allKeys),
      "OPENAI_DALLE"
    );
  });

  it("two unknown-provider keys → ACME_PROD / ACME_STAGING", () => {
    const allKeys = [
      { provider: "acme", label: "prod" },
      { provider: "acme", label: "staging" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "acme", label: "prod" }, allKeys),
      "ACME_PROD"
    );
    assert.equal(
      resolveEnvVar({ provider: "acme", label: "staging" }, allKeys),
      "ACME_STAGING"
    );
  });

  // --- Case insensitivity ---

  it("provider is case-insensitive", () => {
    const result = resolveEnvVar(
      { provider: "OpenAI", label: "main" },
      [{ provider: "OpenAI", label: "main" }]
    );
    assert.equal(result, "OPENAI_API_KEY");
  });

  it("label matching is case-insensitive", () => {
    const allKeys = [
      { provider: "Supabase", label: "Anon" },
      { provider: "Supabase", label: "Service_Role" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "Supabase", label: "Anon" }, allKeys),
      "SUPABASE_ANON_KEY"
    );
  });

  // --- Mixed providers don't interfere ---

  it("keys from different providers resolve independently", () => {
    const allKeys = [
      { provider: "openai", label: "main" },
      { provider: "stripe", label: "secret" },
      { provider: "supabase", label: "anon" },
    ];
    assert.equal(
      resolveEnvVar({ provider: "openai", label: "main" }, allKeys),
      "OPENAI_API_KEY"
    );
    assert.equal(
      resolveEnvVar({ provider: "stripe", label: "secret" }, allKeys),
      "STRIPE_SECRET_KEY"
    );
    assert.equal(
      resolveEnvVar({ provider: "supabase", label: "anon" }, allKeys),
      "SUPABASE_ANON_KEY"
    );
  });

  // --- All standard providers in ENV_VAR_MAP ---

  it("all standard providers have correct default env vars", () => {
    const expected: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GOOGLE_API_KEY",
      stripe: "STRIPE_SECRET_KEY",
      aws: "AWS_SECRET_ACCESS_KEY",
      twilio: "TWILIO_AUTH_TOKEN",
      sendgrid: "SENDGRID_API_KEY",
      github: "GITHUB_TOKEN",
      groq: "GROQ_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
    };
    for (const [provider, envVar] of Object.entries(expected)) {
      assert.equal(ENV_VAR_MAP[provider], envVar, `${provider} should map to ${envVar}`);
    }
  });
});
