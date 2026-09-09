import { describe, expect, it } from 'bun:test';

import { publishPublicPageName } from '@/nip05/workflow';
import { ok } from '@solidarity/shared';

describe('publishPublicPageName', () => {
  it('publishes the signed profile before directory registration, then completes kind-0', async () => {
    const calls: string[] = [];
    const result = await publishPublicPageName(
      {
        name: 'alice',
        did: 'did:key:alice',
        relays: ['wss://relay.example'],
        publishProfile: async () => {
          calls.push('profile');
          return ok({
            profile: { acceptedCount: 1 },
            kind0: { acceptedCount: 1 },
          });
        },
      },
      {
        register: async () => {
          calls.push('directory');
          return {
            ok: true,
            name: 'alice',
            pubkey: '11'.repeat(32),
            identifier: 'alice@creds.id',
          };
        },
        updateKind0: async (options) => {
          calls.push(`kind0:${options.nip05}`);
          return ok({ acceptedCount: 1 });
        },
      }
    );

    expect(result).toEqual({ status: 'ready', name: 'alice', identifier: 'alice@creds.id' });
    expect(calls).toEqual(['profile', 'directory', 'kind0:alice@creds.id']);
  });
});
