import { describe, expect, it } from 'bun:test';

import {
  createProofStageTimer,
  withTimedProver,
  withTimedSigner,
} from '../../src/passport/proofTiming';
import type { PassportOpenAcV3Prover } from '../../src/passport/openacV3';

function fakeClock(ticks: readonly number[]): () => number {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)] ?? 0;
}

describe('createProofStageTimer', () => {
  it('logs delta since previous mark and reports total', () => {
    const lines: string[] = [];
    // now() call order: construct(0), mark(120), mark(150), totalMs(150)
    const timer = createProofStageTimer(
      'show',
      (l) => lines.push(l),
      fakeClock([0, 120, 150, 150])
    );
    expect(timer.mark('witness-load')).toBe(120);
    expect(timer.mark('sign')).toBe(30);
    expect(timer.totalMs()).toBe(150);
    expect(lines).toEqual([
      '[zk:timing] flow=show stage=witness-load ms=120',
      '[zk:timing] flow=show stage=sign ms=30',
    ]);
  });
});

describe('withTimedProver', () => {
  it('marks generate:<circuit> and verify:<circuit> and passes results through', async () => {
    const lines: string[] = [];
    const timer = createProofStageTimer(
      'prepare',
      (l) => lines.push(l),
      fakeClock([0, 10, 25])
    );
    const proof = new ArrayBuffer(2);
    const vk = new ArrayBuffer(3);
    const inner: PassportOpenAcV3Prover = {
      generateNoirProof: async () => ({ proof, vk }),
      verifyNoirProof: async () => true,
    };
    const timed = withTimedProver(inner, timer);
    const result = await timed.generateNoirProof('dsc_chain', 'passport', '{}');
    expect(result.proof).toBe(proof);
    expect(await timed.verifyNoirProof(proof, vk)).toBe(true);
    expect(lines).toEqual([
      '[zk:timing] flow=prepare stage=generate:dsc_chain ms=10',
      '[zk:timing] flow=prepare stage=verify:dsc_chain ms=15',
    ]);
  });

  it('still marks when the inner prover throws', async () => {
    const lines: string[] = [];
    const timer = createProofStageTimer('prepare', (l) => lines.push(l), fakeClock([0, 5]));
    const inner: PassportOpenAcV3Prover = {
      generateNoirProof: async () => {
        throw new Error('boom');
      },
      verifyNoirProof: async () => true,
    };
    const timed = withTimedProver(inner, timer);
    await expect(timed.generateNoirProof('openac_show', 'passport', '{}')).rejects.toThrow('boom');
    expect(lines).toEqual(['[zk:timing] flow=prepare stage=generate:openac_show ms=5']);
  });
});

describe('withTimedSigner', () => {
  it('marks sign (Face ID wait inclusive) and passes the result through', async () => {
    const lines: string[] = [];
    const timer = createProofStageTimer('show', (l) => lines.push(l), fakeClock([0, 900]));
    const signature = new Uint8Array(64);
    const publicKeyRaw = new Uint8Array(64);
    const timed = withTimedSigner(async () => ({ signature, publicKeyRaw }), timer);
    const out = await timed(new Uint8Array(32));
    expect(out.signature).toBe(signature);
    expect(lines).toEqual(['[zk:timing] flow=show stage=sign ms=900']);
  });
});
