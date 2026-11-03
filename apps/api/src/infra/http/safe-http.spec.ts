import { describe, expect, it } from 'vitest';
import { BlockedUrlError, checkUrlShape, isBlockedAddress } from './safe-http.js';

/** SSRF guard unit tests (change #19 wave C). Run: `pnpm --filter @vistar/api test safe-http`. */
describe('isBlockedAddress', () => {
  it.each(['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.0.1', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '64:ff9b::a00:1'])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '103.21.244.0', '2606:4700:4700::1111'])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('checkUrlShape (dev allowlist localhost, 127.0.0.1, ::1)', () => {
  it('https public is fine; http only for allowlisted hosts', () => {
    expect(checkUrlShape('https://erp.example.in/hook').hostname).toBe('erp.example.in');
    expect(checkUrlShape('http://127.0.0.1:9000/hook').port).toBe('9000');
    expect(() => checkUrlShape('http://erp.example.in/hook')).toThrow(BlockedUrlError);
  });
  it('private literals, credentials and junk are refused', () => {
    expect(() => checkUrlShape('https://10.0.0.1/x')).toThrow(BlockedUrlError);
    expect(() => checkUrlShape('https://169.254.169.254/latest')).toThrow(BlockedUrlError);
    expect(() => checkUrlShape('https://user:pass@erp.example.in/')).toThrow(BlockedUrlError);
    expect(() => checkUrlShape('ftp://erp.example.in/')).toThrow(BlockedUrlError);
    expect(() => checkUrlShape('not a url')).toThrow(BlockedUrlError);
  });
});
