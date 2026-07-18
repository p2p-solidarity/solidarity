import { err, ok } from '../types/result';

import { isValidAtprotoHandle } from './atproto';
import { parseDidPointer, parseDidPointerRecords } from './didPointer';
import type { HandleResolutionResult, HandleResolver, ResolverIO, ResolverIoError } from './types';

const DNS_PREFIX = 'dns:';

export function normalizeDnsHandle(handle: string): string {
  const normalized = handle.trim().toLowerCase();
  return normalized.startsWith(DNS_PREFIX) ? normalized.slice(DNS_PREFIX.length) : normalized;
}

export function isValidDnsHandle(handle: string): boolean {
  const domain = normalizeDnsHandle(handle);
  // ATProto accepts a display-style leading `@`; DNS authority names do not.
  // It also trims input, so reject prefix-adjacent whitespace before
  // delegating to the otherwise-shared hostname rules.
  return (
    domain === domain.trim() &&
    !domain.startsWith('@') &&
    isValidAtprotoHandle(domain) &&
    !domain.endsWith('.eth')
  );
}

function resultFromPointer(pointer: ReturnType<typeof parseDidPointer> & { readonly ok: true }) {
  return ok({ did: pointer.value.did, sources: pointer.value.sources });
}

function fallbackError(
  dnsError: ResolverIoError | null,
  wellKnownError: ResolverIoError
): HandleResolutionResult {
  if (dnsError === 'unreachable' && wellKnownError === 'notFound') return err('unreachable');
  return err(wellKnownError);
}

export class DnsHandleResolver implements HandleResolver {
  readonly scheme = 'dns' as const;

  matches(handle: string): boolean {
    return isValidDnsHandle(handle);
  }

  async resolve(handle: string, io: ResolverIO): Promise<HandleResolutionResult> {
    if (!isValidDnsHandle(handle)) return err('invalidHandle');
    const domain = normalizeDnsHandle(handle);

    try {
      const dnsResult = await io.dnsTxt(`_did.${domain}`);
      let dnsError: ResolverIoError | null = null;
      if (dnsResult.ok) {
        const pointer = parseDidPointerRecords(dnsResult.value);
        if (!pointer.ok) return pointer;
        if (pointer.value !== null) {
          return ok({ did: pointer.value.did, sources: pointer.value.sources });
        }
      } else {
        dnsError = dnsResult.error;
        if (dnsError !== 'notFound' && dnsError !== 'unreachable') return err(dnsError);
      }

      // Constructed here rather than accepted from TXT: DNS handles may only
      // use the fixed HTTPS endpoint, never an HTTP/user-supplied URL.
      const wellKnown = await io.fetchText(`https://${domain}/.well-known/did`);
      if (!wellKnown.ok) return fallbackError(dnsError, wellKnown.error);
      if (wellKnown.value === null) {
        return dnsError === 'unreachable' ? err('unreachable') : err('notFound');
      }

      const pointer = parseDidPointer(wellKnown.value);
      return pointer.ok ? resultFromPointer(pointer) : pointer;
    } catch {
      return err('unreachable');
    }
  }
}
