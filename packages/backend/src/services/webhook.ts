import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';

export type WebhookEvent = 'key.stored' | 'key.revoked' | 'key.expired' | 'key.validated' | 'proxy.call';

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Returns true if the resolved IP is in a private/reserved range.
 * DNS failures are treated as private (fail-closed).
 */
async function isPrivateIp(hostname: string): Promise<boolean> {
  try {
    const { address } = await lookup(hostname);
    const parts = address.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    if (address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
    return false;
  } catch {
    return true; // DNS failure = reject
  }
}

export function sendWebhook(
  url: string,
  secret: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): void {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  // Non-blocking — abort after 5 s so a slow or unresponsive endpoint
  // doesn't hold open a connection indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  // Re-validate the webhook destination IP at send time to prevent
  // DNS rebinding attacks (hostname may have resolved differently at
  // registration time).
  const parsedUrl = new URL(url);
  isPrivateIp(parsedUrl.hostname).then((isPrivate) => {
    if (isPrivate) {
      clearTimeout(timer);
      throw new Error('Webhook URL resolves to private IP');
    }

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VaultProof-Signature': signature,
        'X-VaultProof-Event': event,
      },
      body,
      signal: controller.signal,
    });
  }).catch(() => {}).finally(() => clearTimeout(timer));
}
