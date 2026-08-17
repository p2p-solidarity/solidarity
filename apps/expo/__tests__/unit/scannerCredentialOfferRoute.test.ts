import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { credentialOfferRouteFromScan } from '../../src/scan/credentialOfferRoute';

describe('credentialOfferRouteFromScan', () => {
  it('routes the exact scanned credential-offer payload to the issuance screen', () => {
    const payload =
      'openid-credential-offer://?credential_offer=%7B%22credential_issuer%22%3A%22https%3A%2F%2Fissuer.example%22%2C%22credential_configuration_ids%22%3A%5B%22EmployeeID%22%5D%7D&user_hint=Ada%20Lovelace';

    expect(credentialOfferRouteFromScan(payload)).toEqual({
      pathname: '/credentials/offer',
      params: { q: payload },
    });
  });

  it('leaves every non-offer payload to the existing scanner dispatch', () => {
    for (const payload of [
      'openid4vp://present?client_id=demo',
      'openid-vp://verify?vp_token=token',
      'https://solidarity.gg/#profile-fragment',
      'not a URL',
    ]) {
      expect(credentialOfferRouteFromScan(payload)).toBeNull();
    }
  });

  it('dispatches credential offers before the generic envelope/OIDC pipeline', () => {
    const source = readFileSync(new URL('../../app/scan/index.tsx', import.meta.url), 'utf8');
    const offerDispatch = source.indexOf('credentialOfferRouteFromScan(payload)');
    const genericDispatch = source.indexOf('handleScannedPayload(payload)');

    expect(offerDispatch).toBeGreaterThan(-1);
    expect(genericDispatch).toBeGreaterThan(offerDispatch);
    expect(source).toContain('router.push(credentialOfferRoute);');
  });
});
