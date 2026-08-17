/**
 * Headless ATProto connect orchestration (task S2).
 *
 * Dependencies are pure in-memory doubles. The main regression pin is that
 * the desired at:// claim is passed into the Face-ID-gated profile save and
 * only the JWS returned by that save can reach putRecord.
 */
import { describe, expect, it } from 'bun:test';

import {
  connectAtproto,
  disconnectAtproto,
  type AtprotoConnectDependencies,
  type AtprotoDisconnectDependencies,
} from '@/atproto/connect';
import type { AtprotoSession } from '@/atproto/session';
import { ok, type ProfileRecord } from '@solidarity/shared';

const HANDLE = 'alice.example.social';
const REPO_DID = 'did:plc:aliceexample1234';

const SESSION: AtprotoSession = {
  did: REPO_DID,
  handle: HANDLE,
  pdsUrl: 'https://pds.example.social',
  authServerIssuer: 'https://auth.example.social',
  tokenEndpoint: 'https://auth.example.social/oauth/token',
  accessToken: 'access-token',
  accessTokenExpiresAtMs: Date.now() + 300_000,
  scope: 'atproto transition:generic',
};

function profile(alsoKnownAs: readonly string[] = []): ProfileRecord {
  return {
    v: 1,
    did: 'did:key:zDnaSolidarityProfileOwner',
    displayName: 'Alice',
    avatar: null,
    bio: 'hello',
    links: [{ label: 'Site', url: 'https://alice.example' }],
    alsoKnownAs: [...alsoKnownAs],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function makeDependencies(
  currentProfile: ProfileRecord,
  events: string[]
): AtprotoConnectDependencies & AtprotoDisconnectDependencies {
  return {
    resolveIdentity: (handle) => {
      events.push(`resolve:${handle}`);
      return Promise.resolve(ok({ did: REPO_DID, handle: HANDLE, pdsUrl: SESSION.pdsUrl }));
    },
    readProfile: () => {
      events.push('readProfile');
      return Promise.resolve({
        record: currentProfile,
        linkVisibility: currentProfile.links.map(() => 'public' as const),
      });
    },
    saveProfile: (_fields, options) => {
      const aliases = options.alsoKnownAs ?? [];
      events.push(`sign:${aliases.join(',')}`);
      return Promise.resolve(
        ok({
          record: { ...currentProfile, alsoKnownAs: [...aliases] },
          jws: 'newly-signed-profile-jws',
          published: {
            record: {
              ...currentProfile,
              alsoKnownAs: [...aliases],
              scope: 'public',
            },
            jws: 'newly-signed-public-profile-jws',
          },
        })
      );
    },
    putProfileRecord: (_session, jws) => {
      events.push(`put:${jws}`);
      return Promise.resolve(ok(undefined));
    },
    clearSession: () => {
      events.push('clearSession');
      return Promise.resolve(ok(undefined));
    },
  };
}

describe('connectAtproto', () => {
  it('pins aka → sign → put, and put receives only the newly returned JWS', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(profile(['nostr:npub1alice']), events);

    const result = await connectAtproto(SESSION, {}, dependencies);

    expect(result).toEqual({
      ok: true,
      value: { kind: 'connected', handle: HANDLE, repoDid: REPO_DID },
    });
    expect(events).toEqual([
      `resolve:${HANDLE}`,
      'readProfile',
      `sign:nostr:npub1alice,at://${HANDLE}`,
      'put:newly-signed-public-profile-jws',
    ]);
  });

  it('surfaces a replacement-confirmation Result variant before signing or writing', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(
      profile(['nostr:npub1alice', 'at://old.example.social']),
      events
    );

    const result = await connectAtproto(SESSION, {}, dependencies);

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'replacementConfirmationRequired',
        existingHandle: 'old.example.social',
        replacementHandle: HANDLE,
      },
    });
    expect(events).toEqual([`resolve:${HANDLE}`, 'readProfile']);
  });

  it('after explicit confirmation, replaces every old at:// claim but preserves other aliases', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(
      profile(['at://old.example.social', 'nostr:npub1alice', 'at://duplicate-old.example']),
      events
    );

    const result = await connectAtproto(SESSION, { confirmReplacement: true }, dependencies);

    expect(result.ok).toBe(true);
    expect(events).toContain(`sign:at://${HANDLE},nostr:npub1alice`);
    expect(events.at(-1)).toBe('put:newly-signed-public-profile-jws');
  });

  it('preserves link privacy and writes only the public projection to the PDS', async () => {
    const current = {
      ...profile(),
      links: [
        { label: 'Public', url: 'https://public.example' },
        { label: 'Link only', url: 'https://link-only.example' },
        { label: 'Private', url: 'https://private.example' },
      ],
    };
    let savedVisibility: readonly string[] | undefined;
    const writtenJws: string[] = [];
    const dependencies: AtprotoConnectDependencies = {
      resolveIdentity: () =>
        Promise.resolve(ok({ did: REPO_DID, handle: HANDLE, pdsUrl: SESSION.pdsUrl })),
      readProfile: () =>
        Promise.resolve({
          record: current,
          linkVisibility: ['public', 'link-only', 'private'],
        }),
      saveProfile: (fields, options) => {
        savedVisibility = fields.linkVisibility;
        const aliases = options.alsoKnownAs ?? [];
        return Promise.resolve(
          ok({
            record: { ...current, alsoKnownAs: [...aliases] },
            jws: 'full-profile-jws',
            published: {
              record: {
                ...current,
                links: [current.links[0]!],
                alsoKnownAs: [...aliases],
                scope: 'public',
              },
              jws: 'public-profile-jws',
            },
          })
        );
      },
      putProfileRecord: (_session, jws) => {
        writtenJws.push(jws);
        return Promise.resolve(ok(undefined));
      },
    };

    const result = await connectAtproto(SESSION, {}, dependencies);

    expect(result.ok).toBe(true);
    expect(savedVisibility).toEqual(['public', 'link-only', 'private']);
    expect(writtenJws).toEqual(['public-profile-jws']);
  });

  it('fails closed if post-OAuth identity resolution no longer matches the session DID', async () => {
    const events: string[] = [];
    const base = makeDependencies(profile(), events);
    const dependencies: AtprotoConnectDependencies = {
      ...base,
      resolveIdentity: () =>
        Promise.resolve(
          ok({
            did: 'did:plc:differentaccount',
            handle: HANDLE,
            pdsUrl: SESSION.pdsUrl,
          })
        ),
    };

    const result = await connectAtproto(SESSION, {}, dependencies);

    expect(result).toEqual({
      ok: false,
      error: 'sessionIdentityMismatch',
    });
    expect(events).toEqual([]);
  });
});

describe('disconnectAtproto', () => {
  it('clears only OAuth session state and never reads or mutates the profile', async () => {
    const events: string[] = [];
    const currentProfile = profile([`at://${HANDLE}`]);
    const dependencies = makeDependencies(currentProfile, events);

    const result = await disconnectAtproto(dependencies);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(events).toEqual(['clearSession']);
    expect(currentProfile.alsoKnownAs).toEqual([`at://${HANDLE}`]);
  });
});
