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

// Logo hosted on Cloudflare Pages
const LOGO_URL = 'https://vaultproof.dev/logo-md.png';

// Deduplicate expiry warnings: Set of "keyId:date" to send max once per day
const expiryWarningSent = new Set<string>();

// Shared email wrapper
function emailLayout(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width: 520px; width: 100%;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 0 24px 32px;">
              <img src="${LOGO_URL}" alt="VaultProof" width="48" height="48" style="display: block; margin-bottom: 12px;" />
              <span style="font-size: 18px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">VaultProof</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 16px; padding: 36px 32px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 24px 0;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #64748b;">
                <a href="https://vaultproof.dev" style="color: #6366f1; text-decoration: none;">Website</a>
                &nbsp;&middot;&nbsp;
                <a href="https://vaultproof.dev/docs" style="color: #6366f1; text-decoration: none;">Docs</a>
                &nbsp;&middot;&nbsp;
                <a href="https://vaultproof.dev/app" style="color: #6366f1; text-decoration: none;">Dashboard</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #475569;">
                VaultProof &mdash; The password manager for API keys.
              </p>
              <p style="margin: 8px 0 0; font-size: 11px; color: #334155;">
                &copy; ${new Date().getFullYear()} VaultProof. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Welcome email on registration.
 */
export function sendWelcomeEmail(to: string): void {
  if (!resend) return;

  resend.emails.send({
    from: FROM,
    to,
    subject: 'Welcome to VaultProof',
    html: emailLayout(`
      <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #ffffff;">Welcome to VaultProof</h1>
      <p style="margin: 0 0 24px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your API keys are now protected with VaultProof. We split, encrypt, and store your keys so no one can see them — not even us.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 12px; padding: 20px;">
            <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #ffffff;">Get started in 4 steps:</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #94a3b8;">
                  <span style="display: inline-block; width: 20px; height: 20px; background: #6366f1; color: #fff; border-radius: 50%; text-align: center; line-height: 20px; font-size: 11px; font-weight: 700; margin-right: 8px;">1</span>
                  <a href="https://vaultproof.dev/app/settings" style="color: #c7d2fe; text-decoration: none;">Create a developer API key</a>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #94a3b8;">
                  <span style="display: inline-block; width: 20px; height: 20px; background: #6366f1; color: #fff; border-radius: 50%; text-align: center; line-height: 20px; font-size: 11px; font-weight: 700; margin-right: 8px;">2</span>
                  Install: <code style="background: #0a0a0f; padding: 2px 8px; border-radius: 6px; font-size: 12px; color: #a5b4fc; border: 1px solid #1e1e2e;">npm i @vaultproof/sdk</code>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #94a3b8;">
                  <span style="display: inline-block; width: 20px; height: 20px; background: #6366f1; color: #fff; border-radius: 50%; text-align: center; line-height: 20px; font-size: 11px; font-weight: 700; margin-right: 8px;">3</span>
                  <a href="https://vaultproof.dev/app/keys" style="color: #c7d2fe; text-decoration: none;">Store your first API key</a>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #94a3b8;">
                  <span style="display: inline-block; width: 20px; height: 20px; background: #6366f1; color: #fff; border-radius: 50%; text-align: center; line-height: 20px; font-size: 11px; font-weight: 700; margin-right: 8px;">4</span>
                  Change your base URL to VaultProof
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="https://vaultproof.dev/app" style="display: inline-block; background: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 10px; text-decoration: none;">Open Dashboard</a>
          </td>
        </tr>
      </table>
    `),
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
    html: emailLayout(`
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
        <tr>
          <td style="background: #dc262615; border: 1px solid #dc262630; border-radius: 10px; padding: 12px 16px;">
            <p style="margin: 0; font-size: 13px; font-weight: 600; color: #f87171;">Usage Threshold Exceeded</p>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 16px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your developer key <strong style="color: #ffffff;">${keyLabel}</strong> made
        <strong style="color: #f87171;">${callCount} calls</strong> in the last hour,
        exceeding your threshold of <strong style="color: #ffffff;">${threshold}</strong>.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 10px; padding: 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="font-size: 12px; color: #64748b; padding: 4px 0;">Key</td><td style="font-size: 13px; color: #fff; padding: 4px 0; text-align: right;">${keyLabel}</td></tr>
              <tr><td style="font-size: 12px; color: #64748b; padding: 4px 0;">Calls (last hour)</td><td style="font-size: 13px; color: #f87171; padding: 4px 0; text-align: right; font-weight: 600;">${callCount}</td></tr>
              <tr><td style="font-size: 12px; color: #64748b; padding: 4px 0;">Threshold</td><td style="font-size: 13px; color: #fff; padding: 4px 0; text-align: right;">${threshold}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 20px; font-size: 13px; color: #94a3b8; line-height: 1.6;">
        If this is unexpected, revoke the key or restrict it by IP in your
        <a href="https://vaultproof.dev/app/settings" style="color: #6366f1; text-decoration: none;">key settings</a>.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="https://vaultproof.dev/app/settings" style="display: inline-block; background: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 10px; text-decoration: none;">Review Key Settings</a>
          </td>
        </tr>
      </table>
    `),
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
  const urgencyColor = daysLeft <= 1 ? '#ef4444' : daysLeft <= 3 ? '#f59e0b' : '#6366f1';

  resend.emails.send({
    from: FROM,
    to,
    subject: `Key expiring: ${keyLabel} (${provider}) — ${daysLeft} days left`,
    html: emailLayout(`
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
        <tr>
          <td style="background: ${urgencyColor}15; border: 1px solid ${urgencyColor}30; border-radius: 10px; padding: 12px 16px;">
            <p style="margin: 0; font-size: 13px; font-weight: 600; color: ${urgencyColor};">
              ${daysLeft <= 1 ? 'Key Expires Tomorrow' : `Key Expires in ${daysLeft} Days`}
            </p>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 16px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
        Your <strong style="color: #ffffff;">${provider}</strong> key
        <strong style="color: #ffffff;">${keyLabel}</strong> expires in
        <strong style="color: ${urgencyColor};">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 10px; padding: 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="font-size: 12px; color: #64748b; padding: 4px 0;">Key</td><td style="font-size: 13px; color: #fff; padding: 4px 0; text-align: right;">${keyLabel}</td></tr>
              <tr><td style="font-size: 12px; color: #64748b; padding: 4px 0;">Provider</td><td style="font-size: 13px; color: #fff; padding: 4px 0; text-align: right;">${provider}</td></tr>
              <tr><td style="font-size: 12px; color: #64748b; padding: 4px 0;">Expires</td><td style="font-size: 13px; color: ${urgencyColor}; padding: 4px 0; text-align: right; font-weight: 600;">${expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 20px; font-size: 13px; color: #94a3b8; line-height: 1.6;">
        After expiry, proxy calls using this key will be rejected. Rotate the key before it expires.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="https://vaultproof.dev/app/keys" style="display: inline-block; background: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 10px; text-decoration: none;">Rotate Key</a>
          </td>
        </tr>
      </table>
    `),
  }).catch(() => {});
}
