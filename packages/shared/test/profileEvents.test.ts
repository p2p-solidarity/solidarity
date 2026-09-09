/**
 * Profile event builders (src/nostr/profileEvents.ts): the kind-30078 pointer
 * shape, the kind-0 merge that preserves foreign metadata, and the NIP-05
 * identifier shape tied to NIP05_DOMAIN.
 */
import { describe, expect, it } from 'bun:test';

import { NIP05_DOMAIN } from '../src/handles/nip05';
import {
  KIND_METADATA,
  KIND_PROFILE_POINTER,
  PROFILE_D_TAG,
  buildKind0Event,
  buildProfilePointerEvent,
  isNip05Identifier,
  mergeKind0Content,
  parseKind0Content,
} from '../src/nostr/profileEvents';

const DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';

describe('buildProfilePointerEvent', () => {
  it('is a NIP-78 kind-30078 event with the solidarity.profile d tag and the JWS as content', () => {
    expect(buildProfilePointerEvent('a.b.c', 42)).toEqual({
      kind: KIND_PROFILE_POINTER,
      tags: [['d', PROFILE_D_TAG]],
      content: 'a.b.c',
      created_at: 42,
    });
    expect('created_at' in buildProfilePointerEvent('a.b.c')).toBe(false);
  });
});

describe('kind-0 merge', () => {
  it('parses tolerant: non-object or malformed content is an empty base', () => {
    expect(parseKind0Content('{"name":"Alice"}')).toEqual({ name: 'Alice' });
    expect(parseKind0Content('[1]')).toEqual({});
    expect(parseKind0Content('nope')).toEqual({});
  });

  it('adds the did to alsoKnownAs once, sets nip05 when given, and preserves everything else', () => {
    const base = { name: 'Alice', about: 'hi', picture: 'https://x/y.png', alsoKnownAs: ['at://alice.bsky.social', DID], nip05: `old@${NIP05_DOMAIN}` };
    expect(mergeKind0Content(base, { did: DID })).toEqual(base);
    expect(mergeKind0Content(base, { did: DID, nip05: `alice@${NIP05_DOMAIN}` })).toEqual({ ...base, nip05: `alice@${NIP05_DOMAIN}` });
    expect(mergeKind0Content({ alsoKnownAs: ['x', 7, null] }, { did: DID })).toEqual({ alsoKnownAs: ['x', DID] });
    expect(mergeKind0Content({}, { did: DID })).toEqual({ alsoKnownAs: [DID] });
  });

  it('builds a kind-0 event carrying the merged content verbatim', () => {
    const content = mergeKind0Content({ name: 'Alice' }, { did: DID });
    expect(buildKind0Event(content, 9)).toEqual({ kind: KIND_METADATA, tags: [], content: JSON.stringify(content), created_at: 9 });
  });
});

describe('isNip05Identifier', () => {
  it('accepts only name@<NIP05_DOMAIN> in the directory shape', () => {
    expect(isNip05Identifier(`alice@${NIP05_DOMAIN}`)).toBe(true);
    expect(isNip05Identifier('alice@solidarity.gg')).toBe(NIP05_DOMAIN === 'solidarity.gg');
    expect(isNip05Identifier(`Alice@${NIP05_DOMAIN}`)).toBe(false);
    expect(isNip05Identifier(`al@${NIP05_DOMAIN}`)).toBe(false);
    expect(isNip05Identifier(`alice@evil-${NIP05_DOMAIN}`)).toBe(false);
    expect(isNip05Identifier('alice@credsXid')).toBe(false);
    expect(isNip05Identifier('alice@example.com', 'example.com')).toBe(true);
  });
});
