/**
 * Parity test — NullifierStore replay protection.
 *
 * Mirrors the contract enforced by solidarity/Services/ZK/NullifierStore.swift:
 *   1. `hasNullifier(scope, nullifier)` returns false until the pair is
 *      recorded.
 *   2. `recordNullifier(scope, nullifier)` makes subsequent `hasNullifier`
 *      calls for the SAME pair return true.
 *   3. Different scopes for the same nullifier are tracked independently —
 *      i.e. the key is `scope|nullifier`, not just `nullifier`.
 *
 * The TS layer goes through `apps/expo/src/zk/nullifierStore.ts`, which
 * delegates to the Nitro module. We mock the native module here so the
 * test runs in pure-JS land — the on-device behaviour is verified
 * separately by the XCUITest harness, but the *contract* is the same
 * code path and is covered here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { HybridObject } from 'react-native-nitro-modules';

import type { Semaphore, SemaphoreProof } from '@solidarity/nitro-attest';

import { hasNullifier, recordNullifier } from '../../src/zk';
import { __setSemaphoreNativeForTesting } from '../../src/zk/nativeBridge';

// ─── In-memory mock that mirrors the native contract ───────────────────

class MockSemaphore implements Semaphore {
  // Required by HybridObject<…> base type.
  readonly name = 'MockSemaphore';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equals(_other: HybridObject<any>): boolean { return _other === this as unknown as HybridObject<any>; }
  dispose(): void { /* no-op for the in-memory test double */ }

  private readonly seen = new Set<string>();
  private cachedCommitment = '';

  private key(scope: string, nullifier: string): string {
    return `${scope}|${nullifier}`;
  }

  hasNullifier(scope: string, nullifier: string): boolean {
    return this.seen.has(this.key(scope, nullifier));
  }
  recordNullifier(scope: string, nullifier: string): void {
    this.seen.add(this.key(scope, nullifier));
  }

  // Stubs — not exercised by this suite, but required by the interface.
  generateIdentity(): Promise<string> { return Promise.resolve(''); }
  identityFromSeed(_seed: ArrayBuffer): Promise<string> { return Promise.resolve(''); }
  getCommitment(): string { return this.cachedCommitment; }
  loadIdentityFromKeychain(_alias: string): Promise<boolean> { return Promise.resolve(false); }
  storeIdentityToKeychain(_alias: string): Promise<void> { return Promise.resolve(); }
  deleteIdentity(): Promise<void> { return Promise.resolve(); }
  exportPrivateKey(): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(0)); }
  importPrivateKey(_bytes: ArrayBuffer): Promise<string> { return Promise.resolve(''); }
  groupRootFromCommitments(_c: string[]): Promise<string> { return Promise.resolve('0'); }
  generateProof(_c: string[], _s: string, _x: string): Promise<SemaphoreProof> {
    return Promise.resolve({
      nullifier: '', merkleRoot: '', scope: '', signal: '',
      proofJson: '{}', merkleTreeDepth: 16,
    });
  }
  verifyProof(_p: SemaphoreProof, _d: number): Promise<boolean> { return Promise.resolve(false); }
  extractNullifier(p: SemaphoreProof): string { return p.nullifier; }
}

let mock: MockSemaphore;

beforeEach(() => {
  mock = new MockSemaphore();
  __setSemaphoreNativeForTesting(mock);
});

afterEach(() => {
  __setSemaphoreNativeForTesting(null);
});

describe('NullifierStore parity', () => {
  it('returns false for an unseen (scope, nullifier) pair', async () => {
    expect(await hasNullifier('voting:proposal-1', 'nullifier-xyz')).toBe(false);
  });

  it('returns true after the same pair is recorded', async () => {
    await recordNullifier('voting:proposal-1', 'nullifier-xyz');
    expect(await hasNullifier('voting:proposal-1', 'nullifier-xyz')).toBe(true);
  });

  it('treats different scopes as independent (key is `scope|nullifier`)', async () => {
    await recordNullifier('voting:proposal-1', 'shared-nullifier');
    // Same nullifier under a different scope should still be unrecorded.
    expect(await hasNullifier('voting:proposal-2', 'shared-nullifier')).toBe(false);
    // And recording it under that other scope flips only that bucket.
    await recordNullifier('voting:proposal-2', 'shared-nullifier');
    expect(await hasNullifier('voting:proposal-1', 'shared-nullifier')).toBe(true);
    expect(await hasNullifier('voting:proposal-2', 'shared-nullifier')).toBe(true);
  });

  it('rejects a second submission for the same (scope, nullifier)', async () => {
    // The "rejection" is the verifier's responsibility — NullifierStore just
    // reports whether the pair has been seen. This test pins the read↔write
    // ordering that the relying-party verifier loop depends on.
    const scope = 'group:abc';
    const nullifier = 'one-time-token-001';

    // Step 1: never seen → caller proceeds with verification + records.
    expect(await hasNullifier(scope, nullifier)).toBe(false);
    await recordNullifier(scope, nullifier);

    // Step 2: the same nullifier comes back from a replay attempt.
    expect(await hasNullifier(scope, nullifier)).toBe(true);
    // The caller (proofVerifier / GroupCredentialService) is expected to
    // throw `Error.replayDetected` in this branch — see Swift
    // SemaphoreIdentityManager.swift:273-278 for the exact pattern.
  });

  it('record is idempotent — recording the same pair twice is a no-op', async () => {
    await recordNullifier('s', 'n');
    await recordNullifier('s', 'n');
    expect(await hasNullifier('s', 'n')).toBe(true);
  });
});
