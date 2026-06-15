import { describe, expect, it } from 'bun:test';

import { createMmkvConfig } from '../../src/storage/mmkvConfig';

describe('createMmkvConfig', () => {
  it('derives an MMKV v4-compatible AES-256 key', () => {
    const masterKey = new Uint8Array(32);
    for (let i = 0; i < masterKey.length; i += 1) masterKey[i] = i;

    const config = createMmkvConfig(masterKey);

    expect(config.id).toBe('solidarity');
    expect(config.encryptionType).toBe('AES-256');
    expect(config.encryptionKey).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('is stable for the same master key and changes for a different key', () => {
    const a = new Uint8Array(32).fill(0x11);
    const b = new Uint8Array(32).fill(0x22);

    expect(createMmkvConfig(a).encryptionKey).toBe(createMmkvConfig(a).encryptionKey);
    expect(createMmkvConfig(a).encryptionKey).not.toBe(createMmkvConfig(b).encryptionKey);
  });
});
