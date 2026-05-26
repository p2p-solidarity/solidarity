import type { BusinessCard } from '@solidarity/shared';

import {
  buildSolidarityQrPayloadAsync,
  type ShareFieldPreferences,
} from '@/cards/solidarityQrPayload';
import {
  didKeyForCurrentIdentity,
  publicJwk,
  signJwt,
} from '@/keychain/signingKey';

export async function buildRuntimeSolidarityQrPayload(
  card: BusinessCard,
  shareFieldPreferences: ShareFieldPreferences
): Promise<string> {
  const options = {
    sharingLevel: 'professional' as const,
    shareFieldPreferences,
  };

  try {
    const [issuerDid, jwk] = await Promise.all([
      didKeyForCurrentIdentity(),
      publicJwk(),
    ]);
    return await buildSolidarityQrPayloadAsync(card, {
      ...options,
      signer: {
        issuerDid,
        publicKeyJwk: jwk,
        signJwt,
      },
    });
  } catch {
    return buildSolidarityQrPayloadAsync(card, options);
  }
}
