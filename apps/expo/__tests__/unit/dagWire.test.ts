/**
 * DAG wire frameKind multiplex — round-trip + drain + dispatch tests.
 * Spec: docs/dev-sandbox-identity-graph.md §5.1.
 */
import { describe, expect, test } from 'bun:test';

import {
  FRAME_KIND_HEADS,
  FRAME_KIND_NODE,
  FRAME_KIND_WANT,
  FRAME_KIND_WEBRTC_ICE,
  FRAME_KIND_WEBRTC_SDP,
  decodeDagFrame,
  decodeHashList,
  decodeNodeBody,
  decodeStringBody,
  drainDagFrames,
  encodeDagFrame,
  encodeHashList,
  encodeNodeBody,
  encodeStringBody,
  isDagFrameKind,
} from '@/dag/wire';
import { frameMessage as proxFrameMessage } from '@/proximity/wire';

const HASH_A = 'ab'.repeat(32);
const HASH_B = 'cd'.repeat(32);
const HASH_C = 'ef'.repeat(32);

describe('dagWire — round-trip', () => {
  test('encode + drain returns the same DAG frame', () => {
    const original = { kind: FRAME_KIND_HEADS as const, body: encodeHashList([HASH_A]) };
    const wire = encodeDagFrame(original);
    const { dag, otherPayloads, rest } = drainDagFrames(wire);
    expect(rest.length).toBe(0);
    expect(otherPayloads.length).toBe(0);
    expect(dag.length).toBe(1);
    expect(dag[0]?.kind).toBe(FRAME_KIND_HEADS);
    expect(decodeHashList(dag[0]!.body)).toEqual([HASH_A]);
  });

  test('two concatenated frames decode in order', () => {
    const a = encodeDagFrame({ kind: FRAME_KIND_HEADS, body: encodeHashList([HASH_A, HASH_B]) });
    const b = encodeDagFrame({ kind: FRAME_KIND_NODE, body: encodeNodeBody('{"a":1}') });
    const buf = new Uint8Array(a.length + b.length);
    buf.set(a, 0);
    buf.set(b, a.length);
    const { dag } = drainDagFrames(buf);
    expect(dag.length).toBe(2);
    expect(decodeHashList(dag[0]!.body)).toEqual([HASH_A, HASH_B]);
    expect(decodeNodeBody(dag[1]!.body)).toBe('{"a":1}');
  });

  test('WANT / SDP / ICE bodies round-trip', () => {
    const want = encodeDagFrame({ kind: FRAME_KIND_WANT, body: encodeHashList([HASH_C]) });
    const sdp = encodeDagFrame({ kind: FRAME_KIND_WEBRTC_SDP, body: encodeStringBody('v=0\nm=application 9 DTLS/SCTP webrtc-datachannel') });
    const ice = encodeDagFrame({ kind: FRAME_KIND_WEBRTC_ICE, body: encodeStringBody('candidate:1 1 udp 2122260223 192.168.1.1 54321 typ host') });
    const buf = new Uint8Array(want.length + sdp.length + ice.length);
    buf.set(want, 0);
    buf.set(sdp, want.length);
    buf.set(ice, want.length + sdp.length);
    const { dag } = drainDagFrames(buf);
    expect(dag.length).toBe(3);
    expect(dag[0]!.kind).toBe(FRAME_KIND_WANT);
    expect(decodeHashList(dag[0]!.body)).toEqual([HASH_C]);
    expect(dag[1]!.kind).toBe(FRAME_KIND_WEBRTC_SDP);
    expect(decodeStringBody(dag[1]!.body).startsWith('v=0')).toBe(true);
    expect(dag[2]!.kind).toBe(FRAME_KIND_WEBRTC_ICE);
    expect(decodeStringBody(dag[2]!.body).startsWith('candidate:')).toBe(true);
  });
});

describe('dagWire — dispatch boundary', () => {
  test('proximity frames in the 0x80–0xFF window route to otherPayloads, not dag', () => {
    const dagBytes = encodeDagFrame({ kind: FRAME_KIND_HEADS, body: encodeHashList([HASH_A]) });
    // Simulate the existing card-exchange protocol: a proximity-wire-framed
    // payload whose first byte is 0x80 (well outside the DAG kind window).
    const cardExchange = proxFrameMessage(new Uint8Array([0x80, 1, 2, 3, 4, 5]));
    const buf = new Uint8Array(dagBytes.length + cardExchange.length);
    buf.set(dagBytes, 0);
    buf.set(cardExchange, dagBytes.length);
    const { dag, otherPayloads, rest } = drainDagFrames(buf);
    expect(rest.length).toBe(0);
    expect(dag.length).toBe(1);
    expect(otherPayloads.length).toBe(1);
    expect(otherPayloads[0]?.[0]).toBe(0x80);
  });

  test('isDagFrameKind returns true for our window, false otherwise', () => {
    expect(isDagFrameKind(FRAME_KIND_HEADS)).toBe(true);
    expect(isDagFrameKind(FRAME_KIND_WEBRTC_ICE)).toBe(true);
    expect(isDagFrameKind(0x80)).toBe(false);
    expect(isDagFrameKind(0x00)).toBe(false);
    expect(isDagFrameKind(0xff)).toBe(false);
  });

  test('decodeDagFrame throws on unknown kind so a stream regression fails loudly', () => {
    expect(() => decodeDagFrame(new Uint8Array([0xff, 1, 2]))).toThrow(/Unknown DAG frameKind/);
    expect(() => decodeDagFrame(new Uint8Array([]))).toThrow(/too short/);
  });
});

describe('dagWire — hash list codec edge cases', () => {
  test('decode rejects body length not multiple of 32', () => {
    expect(() => decodeHashList(new Uint8Array(33))).toThrow(/not a multiple of 32/);
  });

  test('encode rejects malformed hex input', () => {
    expect(() => encodeHashList(['xy'.repeat(32)])).toThrow(/not valid hex/);
    expect(() => encodeHashList(['too short'])).toThrow(/not 32 bytes hex/);
  });

  test('empty hash list encodes / decodes to empty body / empty array', () => {
    const body = encodeHashList([]);
    expect(body.length).toBe(0);
    expect(decodeHashList(body)).toEqual([]);
  });
});

describe('dagWire — partial inbound buffer', () => {
  test('truncated frame returns no DAG frames and full buffer as remainder', () => {
    const full = encodeDagFrame({ kind: FRAME_KIND_HEADS, body: encodeHashList([HASH_A, HASH_B]) });
    const truncated = full.slice(0, full.length - 5);
    const { dag, otherPayloads, rest } = drainDagFrames(truncated);
    expect(dag.length).toBe(0);
    expect(otherPayloads.length).toBe(0);
    expect(rest.length).toBe(truncated.length);
  });

  test('two frames where second is partial: first decodes, second held as remainder', () => {
    const a = encodeDagFrame({ kind: FRAME_KIND_HEADS, body: encodeHashList([HASH_A]) });
    const b = encodeDagFrame({ kind: FRAME_KIND_NODE, body: encodeNodeBody('{"b":2}') });
    const partial = b.slice(0, 3);
    const buf = new Uint8Array(a.length + partial.length);
    buf.set(a, 0);
    buf.set(partial, a.length);
    const { dag, rest } = drainDagFrames(buf);
    expect(dag.length).toBe(1);
    expect(decodeHashList(dag[0]!.body)).toEqual([HASH_A]);
    expect(rest.length).toBe(partial.length);
  });
});
