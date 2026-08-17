/**
 * `src/pear/cardRequestState.ts` — the pure requester-side state machine
 * for A5.2's full-card exchange UI. No React/RN/lane involved; see that
 * module's doc for why this is a plain `.ts` file safe for `bun test` to
 * import directly.
 */
import { describe, expect, it } from 'bun:test';

import { PROFILE_VERSION, type ProfileRecord } from '@solidarity/shared';

import {
  cardRequestReducer,
  type CardRequestError,
  type CardRequestPhase,
} from '../../src/pear/cardRequestState';

function testRecord(): ProfileRecord {
  return {
    v: PROFILE_VERSION,
    did: 'did:key:zPeer',
    displayName: 'Peer',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [],
    badges: [],
    supersededBy: null,
    updatedAt: new Date(0).toISOString(),
  };
}

const SOME_ERROR: CardRequestError = { stage: 'connect', kind: 'connection', message: 'boom' };

describe('cardRequestReducer', () => {
  it('start from idle -> connecting', () => {
    const next = cardRequestReducer({ kind: 'idle' }, { type: 'start' });
    expect(next).toEqual({ kind: 'connecting' });
  });

  it('connecting + connected -> authenticating', () => {
    const next = cardRequestReducer({ kind: 'connecting' }, { type: 'connected' });
    expect(next).toEqual({ kind: 'authenticating' });
  });

  it('authenticating + authenticated -> requesting', () => {
    const next = cardRequestReducer({ kind: 'authenticating' }, { type: 'authenticated' });
    expect(next).toEqual({ kind: 'requesting' });
  });

  it('requesting + received -> received, carrying cardJws + record', () => {
    const record = testRecord();
    const next = cardRequestReducer(
      { kind: 'requesting' },
      { type: 'received', cardJws: 'jws-value', record }
    );
    expect(next).toEqual({ kind: 'received', cardJws: 'jws-value', record });
  });

  it('requesting + declined -> declined', () => {
    const next = cardRequestReducer({ kind: 'requesting' }, { type: 'declined' });
    expect(next).toEqual({ kind: 'declined' });
  });

  describe('failed is accepted from any phase', () => {
    const phases: CardRequestPhase[] = [
      { kind: 'idle' },
      { kind: 'connecting' },
      { kind: 'authenticating' },
      { kind: 'requesting' },
      { kind: 'received', cardJws: 'x', record: testRecord() },
      { kind: 'declined' },
      { kind: 'error', error: SOME_ERROR },
    ];
    for (const phase of phases) {
      it(`${phase.kind} + failed -> error`, () => {
        const err: CardRequestError = { stage: 'request', kind: 'timeout', message: 'timed out' };
        const next = cardRequestReducer(phase, { type: 'failed', error: err });
        expect(next).toEqual({ kind: 'error', error: err });
      });
    }
  });

  describe('reset is accepted from any phase and always returns idle', () => {
    const phases: CardRequestPhase[] = [
      { kind: 'idle' },
      { kind: 'connecting' },
      { kind: 'authenticating' },
      { kind: 'requesting' },
      { kind: 'received', cardJws: 'x', record: testRecord() },
      { kind: 'declined' },
      { kind: 'error', error: SOME_ERROR },
    ];
    for (const phase of phases) {
      it(`${phase.kind} + reset -> idle`, () => {
        expect(cardRequestReducer(phase, { type: 'reset' })).toEqual({ kind: 'idle' });
      });
    }
  });

  describe('start restarts a finished run (retry)', () => {
    const terminal: CardRequestPhase[] = [
      { kind: 'received', cardJws: 'x', record: testRecord() },
      { kind: 'declined' },
      { kind: 'error', error: SOME_ERROR },
    ];
    for (const phase of terminal) {
      it(`${phase.kind} + start -> connecting`, () => {
        expect(cardRequestReducer(phase, { type: 'start' })).toEqual({ kind: 'connecting' });
      });
    }
  });

  describe('start is ignored while a run is already in flight (no double-fire)', () => {
    const inFlight: CardRequestPhase[] = [
      { kind: 'connecting' },
      { kind: 'authenticating' },
      { kind: 'requesting' },
    ];
    for (const phase of inFlight) {
      it(`${phase.kind} + start -> unchanged`, () => {
        expect(cardRequestReducer(phase, { type: 'start' })).toEqual(phase);
      });
    }
  });

  describe('out-of-order events are dropped, phase unchanged', () => {
    it('idle + connected -> idle (unchanged)', () => {
      expect(cardRequestReducer({ kind: 'idle' }, { type: 'connected' })).toEqual({ kind: 'idle' });
    });

    it('connecting + authenticated -> connecting (unchanged)', () => {
      expect(cardRequestReducer({ kind: 'connecting' }, { type: 'authenticated' })).toEqual({
        kind: 'connecting',
      });
    });

    it('connecting + received -> connecting (unchanged), never fabricates a card', () => {
      const next = cardRequestReducer(
        { kind: 'connecting' },
        { type: 'received', cardJws: 'x', record: testRecord() }
      );
      expect(next).toEqual({ kind: 'connecting' });
    });

    it('authenticating + declined -> authenticating (unchanged)', () => {
      expect(cardRequestReducer({ kind: 'authenticating' }, { type: 'declined' })).toEqual({
        kind: 'authenticating',
      });
    });

    it('received + declined -> received (unchanged, terminal)', () => {
      const received: CardRequestPhase = { kind: 'received', cardJws: 'x', record: testRecord() };
      expect(cardRequestReducer(received, { type: 'declined' })).toEqual(received);
    });

    it('declined + connected -> declined (unchanged, terminal)', () => {
      expect(cardRequestReducer({ kind: 'declined' }, { type: 'connected' })).toEqual({ kind: 'declined' });
    });
  });
});
