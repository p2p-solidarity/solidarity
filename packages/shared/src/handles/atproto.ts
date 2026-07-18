import { err, ok, type Result } from '../types/result';

import type { HandleResolutionResult, HandleResolver, ResolverIO } from './types';

const HANDLE_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HANDLE_MAX_LENGTH = 253;
const ATPROTO_DID_RE = /^did:(?:plc|web):[A-Za-z0-9._:%-]+$/u;

export function normalizeAtprotoHandle(handle: string): string {
  const trimmed = handle.trim().toLowerCase();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

export function isValidAtprotoHandle(handle: string): boolean {
  const normalized = normalizeAtprotoHandle(handle);
  if (normalized.length === 0 || normalized.length > HANDLE_MAX_LENGTH) {
    return false;
  }
  const labels = normalized.split('.');
  if (labels.length < 2 || !labels.every((label) => HANDLE_LABEL_RE.test(label))) {
    return false;
  }
  const tld = labels[labels.length - 1];
  return tld !== undefined && !/^[0-9]+$/u.test(tld);
}

function parseDidTxt(records: readonly string[]): Result<string | null, 'malformedDid'> {
  for (const record of records) {
    const unquoted = record.replace(/^"|"$/gu, '');
    if (!unquoted.startsWith('did=')) continue;
    const did = unquoted.slice('did='.length);
    return ATPROTO_DID_RE.test(did) ? ok(did) : err('malformedDid');
  }
  return ok(null);
}

export class AtprotoHandleResolver implements HandleResolver {
  readonly scheme = 'atproto' as const;

  matches(handle: string): boolean {
    return isValidAtprotoHandle(handle);
  }

  async resolve(handle: string, io: ResolverIO): Promise<HandleResolutionResult> {
    const normalized = normalizeAtprotoHandle(handle);
    if (!isValidAtprotoHandle(normalized)) return err('invalidHandle');

    try {
      const dnsResult = await io.dnsTxt(`_atproto.${normalized}`);
      const dnsError = dnsResult.ok ? null : dnsResult.error;
      if (dnsResult.ok) {
        const dnsDid = parseDidTxt(dnsResult.value);
        if (!dnsDid.ok) return dnsDid;
        if (dnsDid.value !== null) return ok({ did: dnsDid.value });
      }

      const url = `https://${normalized}/.well-known/atproto-did`;
      const wellKnownResult = await io.fetchText(url);
      if (!wellKnownResult.ok) {
        return dnsError === 'unreachable' ? err('unreachable') : err(wellKnownResult.error);
      }
      if (wellKnownResult.value === null) {
        return dnsError === null || dnsError === 'notFound' ? err('notFound') : err(dnsError);
      }
      const did = wellKnownResult.value.trim();
      return ATPROTO_DID_RE.test(did) ? ok({ did }) : err('malformedDid');
    } catch {
      return err('unreachable');
    }
  }
}
