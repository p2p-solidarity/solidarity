/**
 * NIP-05 directory client — the app-side wrapper over `@solidarity/shared`'s
 * `nip05/client.ts` (the ONE request implementation the web builder uses
 * too). This file only pins the directory origin and this device's Nostr
 * signer; request shapes, NIP-98 authorisation and failure mapping live in
 * shared so app and web can never drift.
 */
import {
  checkNip05Availability as sharedCheckNip05Availability,
  findAvailableNip05Suggestions as sharedFindAvailableNip05Suggestions,
  nip05NameSuggestions as sharedNip05NameSuggestions,
  registerNip05Name as sharedRegisterNip05Name,
  type FetchLike,
  type Nip05SignEvent,
} from '@solidarity/shared';

import { signNostrEvent } from '@/nostr/userKey';

export type {
  Nip05Availability,
  Nip05Registration,
  Nip05UnavailableReason,
} from '@solidarity/shared';

/** The directory answers on the product domain (`name@creds.id`). */
export const NIP05_SERVICE_ORIGIN = 'https://creds.id';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface Nip05ClientOptions {
  readonly fetchImpl?: FetchImpl;
  readonly timeoutMs?: number;
}

interface RegisterOptions extends Nip05ClientOptions {
  readonly name: string;
  readonly relays: readonly string[];
  readonly signEvent?: Nip05SignEvent;
}

/** Adapt the platform `fetch` to the structural signature shared expects. */
function toFetchLike(fetchImpl: FetchImpl): FetchLike {
  return (url, init) =>
    fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
}

export function checkNip05Availability(
  rawName: string,
  options: Nip05ClientOptions = {}
): ReturnType<typeof sharedCheckNip05Availability> {
  return sharedCheckNip05Availability(rawName, {
    origin: NIP05_SERVICE_ORIGIN,
    fetchImpl: toFetchLike(options.fetchImpl ?? fetch),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

export const nip05NameSuggestions = sharedNip05NameSuggestions;

export function findAvailableNip05Suggestions(
  rawName: string,
  options: Nip05ClientOptions = {}
): ReturnType<typeof sharedFindAvailableNip05Suggestions> {
  return sharedFindAvailableNip05Suggestions(rawName, {
    origin: NIP05_SERVICE_ORIGIN,
    fetchImpl: toFetchLike(options.fetchImpl ?? fetch),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

export function registerNip05Name(options: RegisterOptions): ReturnType<typeof sharedRegisterNip05Name> {
  return sharedRegisterNip05Name({
    origin: NIP05_SERVICE_ORIGIN,
    name: options.name,
    relays: options.relays,
    signEvent: options.signEvent ?? signNostrEvent,
    fetchImpl: toFetchLike(options.fetchImpl ?? fetch),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
