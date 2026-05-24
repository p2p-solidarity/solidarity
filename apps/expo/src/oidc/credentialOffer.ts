import { err, ok, type Result } from '@solidarity/shared';

import { oidcError, type OidcError } from './errors';

export interface TxCodeSpec {
  readonly inputMode: string;
  readonly length?: number;
  readonly description?: string;
}

export interface CredentialOffer {
  readonly credentialIssuer: string;
  readonly credentialConfigurationIds: readonly string[];
  readonly preAuthorizedCode?: string;
  readonly txCode?: TxCodeSpec;
}

interface RawOfferGrants {
  readonly ['urn:ietf:params:oauth:grant-type:pre-authorized_code']?: {
    readonly ['pre-authorized_code']?: string;
    readonly tx_code?: unknown;
    readonly user_pin_required?: boolean;
  };
}

interface RawOffer {
  readonly credential_issuer?: string;
  readonly credential_configuration_ids?: readonly string[];
  readonly credentials?: readonly string[];
  readonly grants?: RawOfferGrants;
}

function parseTxCode(value: unknown): TxCodeSpec | undefined {
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    const inputMode = typeof v['input_mode'] === 'string' ? v['input_mode'] : 'numeric';
    const length = typeof v['length'] === 'number' ? v['length'] : undefined;
    const description = typeof v['description'] === 'string' ? v['description'] : undefined;
    const out: TxCodeSpec = { inputMode };
    return {
      ...out,
      ...(length !== undefined ? { length } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  }
  if (value === true) {
    return { inputMode: 'numeric' };
  }
  return undefined;
}

function decodeOffer(json: unknown): Result<CredentialOffer, OidcError> {
  if (typeof json !== 'object' || json === null) {
    return err(oidcError('invalidOffer', 'Credential offer is not an object'));
  }
  const raw = json as RawOffer;
  const issuer = raw.credential_issuer ?? '';
  if (!issuer) {
    return err(oidcError('invalidOffer', 'Missing credential_issuer in offer'));
  }
  const configIds = raw.credential_configuration_ids ?? raw.credentials ?? [];
  const preAuthGrant = raw.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code'];
  const preAuthorizedCode = preAuthGrant?.['pre-authorized_code'];
  let txCode: TxCodeSpec | undefined;
  if (preAuthGrant?.tx_code !== undefined) {
    txCode = parseTxCode(preAuthGrant.tx_code);
  } else if (preAuthGrant?.user_pin_required === true) {
    txCode = { inputMode: 'numeric' };
  }
  return ok({
    credentialIssuer: issuer,
    credentialConfigurationIds: configIds,
    ...(preAuthorizedCode !== undefined ? { preAuthorizedCode } : {}),
    ...(txCode !== undefined ? { txCode } : {}),
  });
}

export function parseCredentialOffer(input: string): Result<CredentialOffer, OidcError> {
  try {
    if (input.includes('credential_offer=')) {
      const u = new URL(input);
      const inline = u.searchParams.get('credential_offer');
      if (inline) {
        const json = JSON.parse(inline) as unknown;
        return decodeOffer(json);
      }
      const remote = u.searchParams.get('credential_offer_uri');
      if (remote) {
        return err(
          oidcError(
            'invalidOffer',
            `credential_offer_uri requires async fetch (use fetchCredentialOfferUri): ${remote}`
          )
        );
      }
      return err(oidcError('invalidOffer', 'No credential_offer or credential_offer_uri'));
    }
    const json = JSON.parse(input) as unknown;
    return decodeOffer(json);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('invalidOffer', `Failed to decode credential offer: ${m}`));
  }
}

export async function fetchCredentialOffer(
  input: string,
  fetchImpl: typeof fetch = fetch
): Promise<Result<CredentialOffer, OidcError>> {
  try {
    if (input.includes('credential_offer_uri=')) {
      const u = new URL(input);
      const remote = u.searchParams.get('credential_offer_uri');
      if (remote) {
        const response = await fetchImpl(remote);
        if (!response.ok) {
          return err(
            oidcError('networkError', `Failed to fetch credential offer: HTTP ${String(response.status)}`, response.status)
          );
        }
        const json = (await response.json()) as unknown;
        return decodeOffer(json);
      }
    }
    return parseCredentialOffer(input);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('networkError', `Failed to fetch credential offer: ${m}`));
  }
}
