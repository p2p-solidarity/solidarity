export interface CredentialOfferScanRoute {
  readonly pathname: '/credentials/offer';
  readonly params: {
    readonly q: string;
  };
}

export function credentialOfferRouteFromScan(
  payload: string
): CredentialOfferScanRoute | null {
  let url: URL;
  try {
    url = new URL(payload);
  } catch {
    return null;
  }

  if (url.protocol !== 'openid-credential-offer:') return null;

  return {
    pathname: '/credentials/offer',
    params: { q: payload },
  };
}
