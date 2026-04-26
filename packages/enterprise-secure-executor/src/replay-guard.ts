import type { SecureExecutionRequest } from '@vaultproof/core';

export interface ReplayGuard {
  consume(request: SecureExecutionRequest): Promise<boolean>;
}

export class InMemoryReplayGuard implements ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 120_000) {}

  async consume(request: SecureExecutionRequest): Promise<boolean> {
    const now = Date.now();
    this.prune(now);

    const expiresAt = Number.isFinite(new Date(request.expiresAt).getTime())
      ? new Date(request.expiresAt).getTime()
      : now + this.ttlMs;
    const key = `${request.requestId}:${request.nonce}`;
    if (this.seen.has(key)) return false;

    this.seen.set(key, Math.min(expiresAt, now + this.ttlMs));
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}

export class NullReplayGuard implements ReplayGuard {
  async consume(): Promise<boolean> {
    return true;
  }
}
