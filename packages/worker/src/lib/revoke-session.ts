interface Session {
  userId: string;
  provider: string;
  sessionData: Record<string, unknown>;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

export function createSession(
  userId: string,
  provider: string,
  sessionData: Record<string, unknown>,
): string {
  cleanExpired();
  const id = crypto.randomUUID();
  sessions.set(id, {
    userId,
    provider,
    sessionData,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return id;
}

export function getSession(
  sessionToken: string,
  userId: string,
): Session | null {
  cleanExpired();
  const session = sessions.get(sessionToken);
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionToken);
    return null;
  }
  return session;
}

export function deleteSession(sessionToken: string): void {
  sessions.delete(sessionToken);
}
