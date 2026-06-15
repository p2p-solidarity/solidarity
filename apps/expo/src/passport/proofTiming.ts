/**
 * Proof-pipeline stage timing (spec §0 “Instrumentation first”,
 * docs/superpowers/specs/2026-06-13-passport-proof-performance-design.md).
 *
 * Decorators around the existing prover/signer interfaces so the pure
 * proof modules stay pure. Log lines are operational only (flow, stage,
 * ms) — no witness/identifier content, safe for release builds.
 */
import type {
  PassportOpenAcV3DeviceSigner,
  PassportOpenAcV3Prover,
} from '@/passport/openacV3';

export type ProofTimingFlow = 'prepare' | 'show';

export interface ProofStageTimer {
  /** Log + return ms elapsed since the previous mark (or construction). */
  mark(stage: string): number;
  /** Ms since construction. */
  totalMs(): number;
}

export function createProofStageTimer(
  flow: ProofTimingFlow,
  log: (line: string) => void = console.log,
  now: () => number = Date.now
): ProofStageTimer {
  const startedAt = now();
  let last = startedAt;
  return {
    mark(stage) {
      const t = now();
      const ms = t - last;
      last = t;
      log(`[zk:timing] flow=${flow} stage=${stage} ms=${String(ms)}`);
      return ms;
    },
    totalMs() {
      return now() - startedAt;
    },
  };
}

/**
 * Times each generate/verify native call. `verifyNoirProof` has no circuit
 * parameter, so the wrapper remembers the last generated circuit — calls
 * are sequential on both pipelines, so the pairing is exact.
 */
export function withTimedProver(
  prover: PassportOpenAcV3Prover,
  timer: ProofStageTimer
): PassportOpenAcV3Prover {
  let lastCircuit = 'unknown';
  return {
    async generateNoirProof(circuitPath, srsPath, inputsJson) {
      lastCircuit = circuitPath;
      try {
        return await prover.generateNoirProof(circuitPath, srsPath, inputsJson);
      } finally {
        timer.mark(`generate:${circuitPath}`);
      }
    },
    async verifyNoirProof(proof, vk) {
      try {
        return await prover.verifyNoirProof(proof, vk);
      } finally {
        timer.mark(`verify:${lastCircuit}`);
      }
    },
  };
}

/** Times the device-binding signature, Face ID wait inclusive. */
export function withTimedSigner(
  sign: PassportOpenAcV3DeviceSigner,
  timer: ProofStageTimer
): PassportOpenAcV3DeviceSigner {
  return async (nonceHash) => {
    try {
      return await sign(nonceHash);
    } finally {
      timer.mark('sign');
    }
  };
}
