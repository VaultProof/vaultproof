import { createHmac } from 'crypto';

export type WebhookEvent = 'key.stored' | 'key.revoked' | 'key.expired' | 'key.validated' | 'proxy.call';

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
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

  // Non-blocking
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VaultProof-Signature': signature,
      'X-VaultProof-Event': event,
    },
    body,
  }).catch(() => {});
}
