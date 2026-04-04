import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use Node environment — Web Crypto (globalThis.crypto) is available in
    // Node 19+ and is the same API used by Cloudflare Workers.
    environment: 'node',
    // Resolve .js extensions to .ts files (TypeScript ESM style)
    alias: {
      // vitest handles this via the resolver below
    },
  },
  resolve: {
    // Allow importing `../lib/crypto.js` to resolve to `../lib/crypto.ts`
    extensions: ['.ts', '.js'],
  },
});
