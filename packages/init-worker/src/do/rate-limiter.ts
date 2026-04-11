/**
 * RateLimiter Durable Object.
 *
 * One DO instance per rate-limit key. CF guarantees all requests to the
 * same key serialize through the same instance, so reads and writes are
 * strongly consistent — unlike KV, which has up to 60s propagation lag
 * and was too weak to catch bursts in PT-9 (2/150 caught).
 *
 * Persistence: `state.storage` survives isolate recycles. Each instance
 * holds ~20 bytes so even millions of active projects fit comfortably.
 *
 * Protocol:
 *   POST /check { limit: number, windowSeconds: number }
 *     → { ok: boolean, count: number, retryAfter?: number }
 */

interface BucketState {
  count: number;
  windowStart: number; // epoch ms
}

export class RateLimiter {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/check' && request.method === 'POST') {
      return this.handleCheck(request);
    }
    if (url.pathname === '/reset' && request.method === 'POST') {
      await this.state.storage.delete('bucket');
      return Response.json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }

  private async handleCheck(request: Request): Promise<Response> {
    const body = (await request.json()) as { limit: number; windowSeconds: number };
    const limit = body.limit;
    const windowMs = body.windowSeconds * 1000;

    if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(body.windowSeconds) || body.windowSeconds <= 0) {
      return Response.json({ error: 'invalid limit or windowSeconds' }, { status: 400 });
    }

    const now = Date.now();
    const stored = await this.state.storage.get<BucketState>('bucket');

    let bucket: BucketState;
    if (!stored || now - stored.windowStart >= windowMs) {
      // New or expired window: reset.
      bucket = { count: 1, windowStart: now };
      await this.state.storage.put('bucket', bucket);
      return Response.json({ ok: true, count: 1 });
    }

    if (stored.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((stored.windowStart + windowMs - now) / 1000));
      return Response.json({ ok: false, count: stored.count, retryAfter });
    }

    bucket = { count: stored.count + 1, windowStart: stored.windowStart };
    await this.state.storage.put('bucket', bucket);
    return Response.json({ ok: true, count: bucket.count });
  }
}
