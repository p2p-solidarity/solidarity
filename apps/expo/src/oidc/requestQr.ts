export interface Oid4VpRequestUrlOptions {
  readonly nonce: string;
  readonly state?: string;
  readonly clientId?: string;
  readonly responseMode?: string;
  readonly redirectUri?: string;
  readonly responseUri?: string;
  readonly presentationDefinition?: PresentationDefinition;
}

interface PresentationDefinition {
  readonly id: string;
  readonly input_descriptors: readonly PresentationInputDescriptor[];
}

interface PresentationInputDescriptor {
  readonly id: string;
  readonly name?: string;
  readonly purpose?: string;
  readonly format?: Readonly<Record<string, unknown>>;
  readonly constraints?: Readonly<Record<string, unknown>>;
}

const DEFAULT_PRESENTATION_DEFINITION: PresentationDefinition = {
  id: 'default-request',
  input_descriptors: [
    {
      id: 'business-card',
      name: 'Business Card',
      purpose: 'Exchange contact info',
    },
  ],
};

export function buildOid4VpRequestUrl({
  nonce,
  clientId = 'https://solidarity.gg/oidc/me',
  responseMode = 'direct_post',
  state,
  redirectUri = 'solidarity://oidc-callback',
  responseUri,
  presentationDefinition = DEFAULT_PRESENTATION_DEFINITION,
}: Oid4VpRequestUrlOptions): string {
  const normalizedNonce = nonce.trim();
  if (!normalizedNonce) {
    throw new Error('OID4VP request nonce is required');
  }

  const queryItems: [string, string][] = [
    ['client_id', clientId],
    ['response_type', 'vp_token'],
    ['response_mode', responseMode],
    ['nonce', normalizedNonce],
  ];
  const normalizedState = state?.trim();
  if (normalizedState) queryItems.push(['state', normalizedState]);

  if (responseMode.toLowerCase().startsWith('direct_post')) {
    queryItems.push(['response_uri', responseUri ?? redirectUri]);
  } else {
    queryItems.push(['redirect_uri', redirectUri]);
  }
  queryItems.push([
    'presentation_definition',
    JSON.stringify(presentationDefinition),
  ]);

  return `openid4vp://authorize?${encodeQueryItems(queryItems)}`;
}

function encodeQueryItems(items: readonly (readonly [string, string])[]): string {
  return items
    .map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');
}
