# Origin Locking Design

**Date:** 2026-04-05
**Status:** Approved

## Summary

Add per-dev-key origin locking so users can restrict their `vp_live_` keys to specific domains. Browsers can't spoof the `Origin` header, so a stolen key is useless on another site.

## Decisions

- **Scope:** Per dev key only (same pattern as `allowed_ips`)
- **Format:** Comma-separated origins: `https://myapp.com, https://staging.myapp.com`
- **Strict mode:** Configurable `strict_origin` flag — when true, requests without an `Origin` header are blocked. When false (default), only requests WITH an `Origin` header are checked.
- **Dashboard UI:** Text input, same style as allowed IPs
- **CLI:** `--origins` and `--strict-origin` flags

## Database

- `allowed_origins` TEXT column already exists on `developer_keys`
- Add `strict_origin` BOOLEAN column, default false

## Changes

### 1. Worker types (`packages/worker/src/types.ts`)
Add to `DevKeyRecord`:
```typescript
allowed_origins: string | null;
strict_origin: boolean;
```

### 2. Proxy check (`packages/worker/src/routes/transparent-proxy.ts`)
After the `allowed_ips` check (line ~172), add:
```typescript
if (auth.devKey.allowed_origins) {
  const origin = request.headers.get('origin') || '';
  const allowed = auth.devKey.allowed_origins.split(',').map(o => o.trim().toLowerCase());
  if (!origin && auth.devKey.strict_origin) {
    return Response.json({ error: 'Origin header required for this API key' }, { status: 403 });
  }
  if (origin && !allowed.includes(origin.toLowerCase())) {
    return Response.json({ error: 'Origin not allowed for this API key' }, { status: 403 });
  }
}
```

### 3. Dev keys route (`packages/worker/src/routes/dev-keys.ts`)
Accept `allowedOrigins` (string) and `strictOrigin` (boolean) in create and update endpoints. Map to `allowed_origins` and `strict_origin` columns.

### 4. Dashboard UI (`apps/site/app/keys.html`)
Add "Allowed Origins" text input and "Strict Origin" checkbox to the key settings panel, below the existing allowed IPs input.

### 5. CLI
Add `--origins` and `--strict-origin` flags to key update command.

### 6. Database migration
```sql
ALTER TABLE developer_keys ADD COLUMN IF NOT EXISTS strict_origin BOOLEAN DEFAULT false;
```
