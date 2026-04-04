/**
 * Atomic OAuth authorization code storage.
 *
 * Guarantees single-use code exchange — concurrent requests to the same
 * code are serialized by the Durable Object's single-threaded execution.
 * Fixes the KV race condition (audit Fix 9).
 */

export class OAuthCodeDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname;

    if (request.method === 'POST' && action === '/store') {
      const { code, data, ttlSeconds } = (await request.json()) as {
        code: string;
        data: string;
        ttlSeconds: number;
      };
      await this.state.storage.put(`code:${code}`, data);
      await this.state.storage.setAlarm(Date.now() + ttlSeconds * 1000);
      return Response.json({ stored: true });
    }

    if (request.method === 'POST' && action === '/exchange') {
      const { code } = (await request.json()) as { code: string };
      const key = `code:${code}`;
      const data = await this.state.storage.get<string>(key);
      if (!data) {
        return Response.json({ found: false });
      }
      // Atomically delete — no other request can use this code
      await this.state.storage.delete(key);
      return Response.json({ found: true, data });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
