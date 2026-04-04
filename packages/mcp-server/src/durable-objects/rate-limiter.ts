/**
 * Atomic rate limiter using Durable Objects.
 *
 * Single-threaded execution guarantees no race conditions on counter
 * increment — fixes the KV eventual consistency bypass (audit Fix 8).
 */

interface RateLimitRequest {
  key: string;
  limit: number;
  windowMs: number;
}

export class RateLimiterDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = (await request.json()) as RateLimitRequest;
    const { key, limit, windowMs } = body;
    const now = Date.now();
    const windowStart = now - windowMs;

    const entries = ((await this.state.storage.get<number[]>(key)) ?? [])
      .filter((ts) => ts > windowStart);

    if (entries.length >= limit) {
      return Response.json({ allowed: false, count: entries.length });
    }

    entries.push(now);
    await this.state.storage.put(key, entries);

    const alarm = await this.state.storage.getAlarm();
    if (!alarm) {
      await this.state.storage.setAlarm(now + windowMs + 1000);
    }

    return Response.json({ allowed: true, count: entries.length });
  }

  async alarm(): Promise<void> {
    const allKeys = await this.state.storage.list<number[]>();
    const now = Date.now();
    for (const [key, entries] of allKeys) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter((ts) => ts > now - 3_600_000);
      if (valid.length === 0) {
        await this.state.storage.delete(key);
      } else {
        await this.state.storage.put(key, valid);
      }
    }
  }
}
