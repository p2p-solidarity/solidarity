/**
 * `src/pear/presentRequestState.ts` — the pure requester-side state machine
 * for A5.3's SD-JWT presentation UI. Mirrors
 * `pearCardRequestState.test.ts`'s structure and coverage.
 */
import { describe, expect, it } from 'bun:test';

import {
  presentRequestReducer,
  type PresentRequestError,
  type PresentRequestPhase,
} from '../../src/pear/presentRequestState';

const SOME_ERROR: PresentRequestError = { stage: 'connect', kind: 'connection', message: 'boom' };
const VERIFIED = { holderDid: 'did:key:zPeer', credentials: [], nonce: 'n' };

describe('presentRequestReducer', () => {
  it('start from idle -> connecting', () => {
    const next = presentRequestReducer({ kind: 'idle' }, { type: 'start' });
    expect(next).toEqual({ kind: 'connecting' });
  });

  it('connecting + connected -> authenticating', () => {
    const next = presentRequestReducer({ kind: 'connecting' }, { type: 'connected' });
    expect(next).toEqual({ kind: 'authenticating' });
  });

  it('authenticating + authenticated -> requesting', () => {
    const next = presentRequestReducer({ kind: 'authenticating' }, { type: 'authenticated' });
    expect(next).toEqual({ kind: 'requesting' });
  });

  it('requesting + verified -> verified, carrying sdJwt + the verified result', () => {
    const next = presentRequestReducer(
      { kind: 'requesting' },
      { type: 'verified', sdJwt: 'jwt-value', verified: VERIFIED }
    );
    expect(next).toEqual({ kind: 'verified', sdJwt: 'jwt-value', verified: VERIFIED });
  });

  it('requesting + declined -> declined', () => {
    const next = presentRequestReducer({ kind: 'requesting' }, { type: 'declined' });
    expect(next).toEqual({ kind: 'declined' });
  });

  it('failed is accepted from ANY phase, including mid-flight ones', () => {
    const phases: readonly PresentRequestPhase[] = [
      { kind: 'idle' },
      { kind: 'connecting' },
      { kind: 'authenticating' },
      { kind: 'requesting' },
      { kind: 'verified', sdJwt: 'x', verified: VERIFIED },
      { kind: 'declined' },
    ];
    for (const phase of phases) {
      const next = presentRequestReducer(phase, { type: 'failed', error: SOME_ERROR });
      expect(next).toEqual({ kind: 'error', error: SOME_ERROR });
    }
  });

  it('reset is accepted from ANY phase and always returns idle', () => {
    const next = presentRequestReducer(
      { kind: 'verified', sdJwt: 'x', verified: VERIFIED },
      { type: 'reset' }
    );
    expect(next).toEqual({ kind: 'idle' });
  });

  it('"start" from a terminal phase (verified/declined/error) restarts the flow', () => {
    for (const phase of [
      { kind: 'verified', sdJwt: 'x', verified: VERIFIED } as const,
      { kind: 'declined' } as const,
      { kind: 'error', error: SOME_ERROR } as const,
    ]) {
      const next = presentRequestReducer(phase, { type: 'start' });
      expect(next).toEqual({ kind: 'connecting' });
    }
  });

  it('"start" while already in flight is a no-op (ignores a double-tap)', () => {
    for (const phase of [
      { kind: 'connecting' } as const,
      { kind: 'authenticating' } as const,
      { kind: 'requesting' } as const,
    ]) {
      const next = presentRequestReducer(phase, { type: 'start' });
      expect(next).toEqual(phase);
    }
  });

  it('out-of-order events are dropped, phase unchanged', () => {
    expect(presentRequestReducer({ kind: 'idle' }, { type: 'connected' })).toEqual({ kind: 'idle' });
    expect(
      presentRequestReducer({ kind: 'connecting' }, { type: 'authenticated' })
    ).toEqual({ kind: 'connecting' });
    expect(
      presentRequestReducer({ kind: 'authenticating' }, { type: 'declined' })
    ).toEqual({ kind: 'authenticating' });
    expect(
      presentRequestReducer(
        { kind: 'verified', sdJwt: 'x', verified: VERIFIED },
        { type: 'connected' }
      )
    ).toEqual({ kind: 'verified', sdJwt: 'x', verified: VERIFIED });
  });
});
