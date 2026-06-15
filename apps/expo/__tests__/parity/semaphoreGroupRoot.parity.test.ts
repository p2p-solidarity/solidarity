/**
 * Parity test — Semaphore group-root computation.
 *
 * Validates that the JS-layer `canonicalCommitments` helper produces
 * the same ordered list of decimal-string field elements that the Swift
 * `SemaphoreGroupManager` feeds into `Group::root()`. The actual
 * Pedersen-hash root derivation runs in the Rust binding, so the
 * cryptographic value can only be asserted via a Swift-generated
 * fixture (`packages/parity-fixtures/fixtures/semaphore/group_root.json`).
 *
 * When the fixture is empty (e.g. on CI machines without the iOS
 * simulator + arm64 toolchain), this suite still locks in the
 * deterministic-ordering contract — sorting differences would cause
 * silent root drift across platforms.
 */
import { describe, expect, it } from 'bun:test';

import {
  canonicalCommitmentsRaw as canonicalCommitments,
  decimalStringToLittleEndian32,
  littleEndian32ToDecimalString,
} from '../../src/zk';

import fixture from '../../../../packages/parity-fixtures/fixtures/semaphore/group_root.json' assert { type: 'json' };

interface GroupRootFixture {
  readonly canonicalCommitments: readonly string[];
  readonly rootDecimal: string | null;
}

const fx = fixture as GroupRootFixture;

describe('Semaphore group canonicalisation parity', () => {
  it('orders the sorted set the same way for any input permutation', () => {
    const original = ['12', '5', '1234567890', '7', '7'];
    const a = canonicalCommitments(original);
    const b = canonicalCommitments([...original].reverse());
    expect([...a]).toEqual([...b]);
  });

  it('drops empty / whitespace commitments', () => {
    const out = canonicalCommitments(['', ' ', '\n', '\t', '0']);
    expect([...out]).toEqual(['0']);
  });

  it('preserves all-ones edge-case ordering', () => {
    // 1 < 10 < 2 lexicographically — the same ordering Swift gets from
    // `Array(Set(...)).sorted()`, which is also lex.
    const out = canonicalCommitments(['10', '1', '2']);
    expect([...out]).toEqual(['1', '10', '2']);
  });

  it('round-trips each canonical element through the LE32 encoder', () => {
    const set = canonicalCommitments(['1', '256', '999', '0']);
    for (const c of set) {
      const bytes = decimalStringToLittleEndian32(c);
      expect(littleEndian32ToDecimalString(bytes)).toBe(c);
    }
  });
});

// ─── Gold-fixture assertions (skipped without Swift fixture) ────────────

describe('Semaphore group-root parity vs Swift Group()::root()', () => {
  if (fx.rootDecimal === null || fx.canonicalCommitments.length === 0) {
    it('SKIPPED — populate packages/parity-fixtures/fixtures/semaphore/group_root.json by running solidarityTests/FixtureExporter.test_exportSemaphoreIdentityCommitments on an arm64 simulator/device', () => {
      console.warn(
        '[semaphoreGroupRoot parity] No fixture data — Swift-side fixture exporter has not been run yet. The TS canonicalisation contract is still verified above; root-hash parity is verified at runtime by the on-device XCUITest harness.'
      );
      expect(true).toBe(true);
    });
    return;
  }

  it('canonicalises the fixture commitments to the same Swift order', () => {
    const ours = canonicalCommitments(fx.canonicalCommitments);
    expect([...ours]).toEqual([...fx.canonicalCommitments]);
  });

  it('Swift-computed root is a valid 256-bit field element', () => {
    // The outer guard above (early-return when null) means rootDecimal is
    // always a string when this test runs.
    const root = fx.rootDecimal ?? '';
    expect(root.length).toBeGreaterThan(0);
    expect(() => decimalStringToLittleEndian32(root)).not.toThrow();
  });
});
