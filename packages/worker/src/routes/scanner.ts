import type { Env } from '../types.js';
import { authenticateUser } from '../lib/jwt-auth.js';

const notImplemented = () =>
  Response.json({ error: 'Not implemented' }, { status: 501 });

export async function handleScanner(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const method = request.method;

  // github/status GET
  if (path === 'github/status' && method === 'GET') {
    return notImplemented();
  }

  // github/connect GET
  if (path === 'github/connect' && method === 'GET') {
    return notImplemented();
  }

  // github/callback POST
  if (path === 'github/callback' && method === 'POST') {
    return notImplemented();
  }

  // github/disconnect DELETE
  if (path === 'github/disconnect' && method === 'DELETE') {
    return notImplemented();
  }

  // repos GET
  if (path === 'repos' && method === 'GET') {
    return notImplemented();
  }

  // scans GET
  if (path === 'scans' && method === 'GET') {
    return notImplemented();
  }

  // scan POST
  if (path === 'scan' && method === 'POST') {
    return notImplemented();
  }

  // scans/:scanId GET
  const scanIdMatch = path.match(/^scans\/([^/]+)$/);
  if (scanIdMatch && method === 'GET') {
    return notImplemented();
  }

  // findings/:findingId/ignore POST
  const findingIgnoreMatch = path.match(/^findings\/([^/]+)\/ignore$/);
  if (findingIgnoreMatch && method === 'POST') {
    return notImplemented();
  }

  // scans/:scanId/create-pr POST
  const createPrMatch = path.match(/^scans\/([^/]+)\/create-pr$/);
  if (createPrMatch && method === 'POST') {
    return notImplemented();
  }

  // scans/:scanId/migrate POST
  const migrateMatch = path.match(/^scans\/([^/]+)\/migrate$/);
  if (migrateMatch && method === 'POST') {
    return notImplemented();
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
