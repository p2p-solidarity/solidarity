import { hexToNpub } from '../nostr/npub';
import { err, ok } from '../types/result';

import type { HandleResolutionResult, HandleResolver, ResolverIO } from './types';

export const NIP05_DOMAIN = 'solidarity.gg';
const NAME_RE = /^[a-z0-9]{3,30}$/u;
const PUBKEY_RE = /^[0-9a-f]{64}$/u;

interface HistoryRecord {
  readonly name: string;
  readonly status: 'active' | 'redirected' | 'released';
  readonly redirectTo: string | null;
  readonly redirectUntil: number | null;
  readonly rebindGeneration: number;
  readonly reboundAt: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeNip05Name(handle: string): string {
  const normalized = handle.trim().toLowerCase();
  return normalized.startsWith('@') ? normalized.slice(1) : normalized;
}

export function isValidNip05Name(handle: string): boolean {
  const normalized = normalizeNip05Name(handle);
  return normalized === normalizeNip05Name(normalized) && NAME_RE.test(normalized);
}

function parseHistory(text: string, expectedName: string): HistoryRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value['name'] !== expectedName ||
    (value['status'] !== 'active' && value['status'] !== 'redirected' && value['status'] !== 'released') ||
    typeof value['rebindGeneration'] !== 'number' ||
    !Number.isSafeInteger(value['rebindGeneration']) ||
    value['rebindGeneration'] < 0 ||
    (value['reboundAt'] !== null &&
      (typeof value['reboundAt'] !== 'number' || !Number.isSafeInteger(value['reboundAt'])))
  ) {
    return null;
  }

  const redirectTo = value['redirectTo'];
  const redirectUntil = value['redirectUntil'];
  if (
    (redirectTo !== null && typeof redirectTo !== 'string') ||
    (redirectUntil !== null &&
      (typeof redirectUntil !== 'number' || !Number.isSafeInteger(redirectUntil)))
  ) {
    return null;
  }
  if (
    value['status'] === 'redirected' &&
    (typeof redirectTo !== 'string' || !NAME_RE.test(redirectTo) || typeof redirectUntil !== 'number')
  ) {
    return null;
  }
  if (value['status'] !== 'redirected' && (redirectTo !== null || redirectUntil !== null)) {
    return null;
  }

  return {
    name: expectedName,
    status: value['status'],
    redirectTo,
    redirectUntil,
    rebindGeneration: value['rebindGeneration'],
    reboundAt: value['reboundAt'],
  };
}

function parseDirectory(
  text: string,
  name: string
): { readonly pubkey: string; readonly relays: readonly string[] } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value['names'])) return null;
  const pubkey = value['names'][name];
  if (typeof pubkey !== 'string' || !PUBKEY_RE.test(pubkey)) return null;

  const relaysRecord = value['relays'];
  if (relaysRecord === undefined) return { pubkey, relays: [] };
  if (!isRecord(relaysRecord)) return null;
  const relays = relaysRecord[pubkey];
  if (relays === undefined) return { pubkey, relays: [] };
  if (!Array.isArray(relays) || !relays.every(isSecureRelayUrl)) return null;
  return { pubkey, relays: [...new Set(relays)] };
}

function isSecureRelayUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' && url.username === '' && url.password === '' && url.hash === '';
  } catch {
    return false;
  }
}

export class Nip05HandleResolver implements HandleResolver {
  readonly scheme = 'nip05' as const;

  matches(handle: string): boolean {
    return isValidNip05Name(handle);
  }

  async resolve(handle: string, io: ResolverIO): Promise<HandleResolutionResult> {
    const name = normalizeNip05Name(handle);
    if (!isValidNip05Name(name)) return err('invalidHandle');

    try {
      const query = encodeURIComponent(name);
      const [directoryResult, historyResult] = await Promise.all([
        io.fetchText(`https://${NIP05_DOMAIN}/.well-known/nostr.json?name=${query}`),
        io.fetchText(`https://${NIP05_DOMAIN}/id/history?name=${query}`),
      ]);

      if (!historyResult.ok) {
        return err(historyResult.error === 'notFound' ? 'notFound' : historyResult.error);
      }
      if (historyResult.value === null) return err('notFound');
      const history = parseHistory(historyResult.value, name);
      if (history === null) return err('conflictingRecords');

      if (history.status === 'redirected') {
        return ok({
          kind: 'nip05',
          status: 'redirected',
          name,
          identifier: `${name}@${NIP05_DOMAIN}`,
          redirectTo: history.redirectTo!,
          redirectUntil: history.redirectUntil!,
          rebindGeneration: history.rebindGeneration,
          reboundAt: history.reboundAt,
        });
      }
      if (history.status === 'released') return err('notFound');

      if (!directoryResult.ok) return err(directoryResult.error);
      if (directoryResult.value === null) return err('notFound');
      const directory = parseDirectory(directoryResult.value, name);
      if (directory === null) return err('conflictingRecords');
      const npub = hexToNpub(directory.pubkey);
      if (!npub.ok) return err('conflictingRecords');

      return ok({
        kind: 'nip05',
        status: 'active',
        name,
        identifier: `${name}@${NIP05_DOMAIN}`,
        pubkey: directory.pubkey,
        npub: npub.value,
        relays: directory.relays,
        sources: [{ kind: 'nostr', npub: npub.value }],
        rebindGeneration: history.rebindGeneration,
        reboundAt: history.reboundAt,
      });
    } catch {
      return err('unreachable');
    }
  }
}
