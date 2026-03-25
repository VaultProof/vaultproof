/**
 * Email service using Resend.
 *
 * All sends are non-blocking (fire and forget).
 * Silently skips if RESEND_API_KEY is not set.
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = 'VaultProof <noreply@vaultproof.dev>';

// Deduplicate expiry warnings: Set of "keyId:date" to send max once per day
const expiryWarningSent = new Set<string>();

/**
 * Welcome email on registration.
 */
export function sendWelcomeEmail(to: string): void {
  if (!resend) return;

  resend.emails.send({
    from: FROM,
    to,
    subject: 'Welcome to VaultProof',
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; color: #e2e8f0;">
        <h1 style="color: #fff; font-size: 24px;">Welcome to VaultProof</h1>
        <p style="color: #94a3b8; line-height: 1.6;">Your API keys are now protected with Shamir secret sharing and zero-knowledge proofs.</p>

        <h3 style="color: #fff; font-size: 16px; margin-top: 24px;">Quick start:</h3>
        <ol style="color: #94a3b8; line-height: 2;">
          <li>Go to <a href="https://vaultproof.dev/app/settings" style="color: #6366f1;">Settings</a> and create a developer API key</li>
          <li>Install the SDK: <code style="background: #1e1e2e; padding: 2px 6px; border-radius: 4px; font-size: 13px;">npm i @vaultproof/sdk</code></li>
          <li>Store your first API key</li>
          <li>Change your SDK's base URL to <code style="background: #1e1e2e; padding: 2px 6px; border-radius: 4px; font-size: 13px;">https://api.vaultproof.dev/v1/openai</code></li>
        </ol>

        <p style="color: #94a3b8; margin-top: 24px;">
          <a href="https://vaultproof.dev/docs" style="color: #6366f1;">Read the docs</a> &middot;
          <a href="https://vaultproof.dev/app" style="color: #6366f1;">Open dashboard</a>
        </p>

        <p style="color: #64748b; font-size: 12px; margin-top: 32px;">VaultProof &mdash; The password manager for API keys.</p>
      </div>
    `,
  }).catch(() => {});
}

/**
 * Usage alert when calls/hour exceeds threshold.
 */
export function sendUsageAlert(
  to: string,
  keyLabel: string,
  callCount: number,
  threshold: number
): void {
  if (!resend) return;

  resend.emails.send({
    from: FROM,
    to,
    subject: `Usage alert: ${keyLabel} exceeded ${threshold} calls/hour`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; color: #e2e8f0;">
        <h2 style="color: #fff; font-size: 20px;">Usage Alert</h2>
        <p style="color: #94a3b8; line-height: 1.6;">
          Your developer key <strong style="color: #fff;">${keyLabel}</strong> made
          <strong style="color: #f87171;">${callCount} calls</strong> in the last hour,
          exceeding your threshold of <strong>${threshold}</strong>.
        </p>

        <p style="color: #94a3b8; line-height: 1.6;">
          If this is unexpected, you can <a href="https://vaultproof.dev/app/settings" style="color: #6366f1;">revoke the key</a>
          or update the IP allowlist in your key settings.
        </p>

        <p style="color: #64748b; font-size: 12px; margin-top: 32px;">VaultProof &mdash; The password manager for API keys.</p>
      </div>
    `,
  }).catch(() => {});
}

/**
 * Key expiry warning (sent max once per day per key).
 */
export function sendKeyExpiryWarning(
  to: string,
  keyLabel: string,
  provider: string,
  expiresAt: Date
): void {
  if (!resend) return;

  const today = new Date().toISOString().split('T')[0];
  const dedupeKey = `${keyLabel}:${today}`;
  if (expiryWarningSent.has(dedupeKey)) return;
  expiryWarningSent.add(dedupeKey);

  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  resend.emails.send({
    from: FROM,
    to,
    subject: `Key expiring: ${keyLabel} (${provider}) — ${daysLeft} days left`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; color: #e2e8f0;">
        <h2 style="color: #fff; font-size: 20px;">Key Expiring Soon</h2>
        <p style="color: #94a3b8; line-height: 1.6;">
          Your <strong style="color: #fff;">${provider}</strong> key
          <strong style="color: #fff;">${keyLabel}</strong> expires in
          <strong style="color: #f59e0b;">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.
        </p>

        <p style="color: #94a3b8; line-height: 1.6;">
          After expiry, proxy calls using this key will be rejected.
          <a href="https://vaultproof.dev/app/keys" style="color: #6366f1;">Rotate the key</a>
          in your dashboard before it expires.
        </p>

        <p style="color: #64748b; font-size: 12px; margin-top: 32px;">VaultProof &mdash; The password manager for API keys.</p>
      </div>
    `,
  }).catch(() => {});
}
