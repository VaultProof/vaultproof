/**
 * Tests for src/lib/ssrf.ts
 */
import { describe, it, expect } from 'vitest';
import { isPublicUrl } from '../lib/ssrf.js';

// ---------------------------------------------------------------------------
// isPublicUrl
// ---------------------------------------------------------------------------
describe('isPublicUrl', () => {
  // --- Should return false ---

  it('blocks http://localhost/foo', () => {
    expect(isPublicUrl('http://localhost/foo')).toBe(false);
  });

  it('blocks http://127.0.0.1/foo', () => {
    expect(isPublicUrl('http://127.0.0.1/foo')).toBe(false);
  });

  it('blocks https://127.0.0.1/foo', () => {
    expect(isPublicUrl('https://127.0.0.1/foo')).toBe(false);
  });

  it('blocks cloud metadata IP (169.254.169.254)', () => {
    expect(isPublicUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('blocks https cloud metadata IP (169.254.169.254)', () => {
    expect(isPublicUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('blocks private range 192.168.x.x', () => {
    expect(isPublicUrl('http://192.168.1.1/admin')).toBe(false);
  });

  it('blocks https 192.168.x.x', () => {
    expect(isPublicUrl('https://192.168.1.1/admin')).toBe(false);
  });

  it('blocks 10.x.x.x range', () => {
    expect(isPublicUrl('https://10.0.0.1/internal')).toBe(false);
  });

  it('blocks 172.16.x.x – 172.31.x.x range', () => {
    expect(isPublicUrl('https://172.16.0.1/internal')).toBe(false);
    expect(isPublicUrl('https://172.31.255.255/internal')).toBe(false);
  });

  it('blocks 0.x.x.x (this-network)', () => {
    expect(isPublicUrl('https://0.0.0.0/foo')).toBe(false);
  });

  it('blocks IPv6 loopback [::1]', () => {
    expect(isPublicUrl('https://[::1]/foo')).toBe(false);
  });

  it('blocks IPv6 link-local fe80::', () => {
    expect(isPublicUrl('https://[fe80::1]/foo')).toBe(false);
  });

  it('blocks decimal-notation IP (2130706433 = 127.0.0.1)', () => {
    expect(isPublicUrl('https://2130706433/foo')).toBe(false);
  });

  it('blocks URLs with credentials', () => {
    expect(isPublicUrl('https://user:pass@api.example.com/v1')).toBe(false);
  });

  it('blocks plain HTTP for public hosts', () => {
    expect(isPublicUrl('http://api.openai.com/v1')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isPublicUrl('not a url')).toBe(false);
    expect(isPublicUrl('')).toBe(false);
  });

  // --- Should return true ---

  it('allows https://api.openai.com/v1', () => {
    expect(isPublicUrl('https://api.openai.com/v1')).toBe(true);
  });

  it('allows https://hooks.slack.com/services/foo', () => {
    expect(isPublicUrl('https://hooks.slack.com/services/foo')).toBe(true);
  });

  it('allows https://vaultproof.dev/webhook', () => {
    expect(isPublicUrl('https://vaultproof.dev/webhook')).toBe(true);
  });

  it('allows https://example.com with path and query', () => {
    expect(isPublicUrl('https://example.com/path?foo=bar')).toBe(true);
  });

  // 172.15 is NOT in the private range (172.16–172.31 is)
  it('allows 172.15.x.x (just outside the private range)', () => {
    expect(isPublicUrl('https://172.15.0.1/api')).toBe(true);
  });
});
