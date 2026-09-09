/**
 * Shared `mock.module` registration for `@solidarity/nitro-attest`.
 *
 * The 2.0.0 nitro convergence merged mrz-ocr / nfc-passport / passport-zk /
 * semaphore into ONE package, so several unit suites now need to stub the
 * SAME module specifier. bun's `mock.module` cannot reliably re-register a
 * specifier from a second test file once the first file's registration has
 * been imported (the cached ESM namespace keeps the first factory's keys),
 * so the registration must happen exactly once — here. Each suite imports
 * this fixture and swaps in the lane implementations it needs via
 * `setAttestMockLanes`; getters for lanes a suite did not provide throw, so
 * an unexpected cross-lane call fails loudly instead of leaking a stale
 * stub from an earlier suite.
 */
import { mock } from 'bun:test';

import type {
  MrzOcr,
  NfcPassport,
  PassportZk,
  Semaphore,
} from '@solidarity/nitro-attest';

export interface AttestMockLanes {
  readonly mrzOcr?: () => MrzOcr;
  readonly nfcPassport?: () => NfcPassport;
  readonly passportZk?: () => PassportZk;
  readonly semaphore?: () => Semaphore;
}

let lanes: AttestMockLanes = {};

/** Replace the full lane set (lanes omitted here throw when accessed). */
export function setAttestMockLanes(next: AttestMockLanes): void {
  lanes = next;
}

function missingLane(name: string): never {
  throw new Error(
    `nitroAttestMock: lane "${name}" is not stubbed by the current suite — ` +
      'pass it to setAttestMockLanes() in this test file'
  );
}

void mock.module('@solidarity/nitro-attest', () => ({
  getMrzOcr: (): MrzOcr => (lanes.mrzOcr ?? (() => missingLane('mrzOcr')))(),
  getNfcPassport: (): NfcPassport =>
    (lanes.nfcPassport ?? (() => missingLane('nfcPassport')))(),
  getPassportZk: (): PassportZk =>
    (lanes.passportZk ?? (() => missingLane('passportZk')))(),
  getSemaphore: (): Semaphore =>
    (lanes.semaphore ?? (() => missingLane('semaphore')))(),
}));
