/**
 * IssuerTrustAnchorStore — TS port of
 * solidarity/Services/Identity/IssuerTrustAnchorStore.swift.
 *
 * Holds the user's trusted issuer DIDs. Used by parseAuthRequest /
 * verifyVcJwt to decide whether a Request-Object signature or VC issuer is
 * acceptable. Persistence is encrypted MMKV under the `trust-anchor:`
 * prefix, matching the AES-GCM blob format the credential store already
 * uses.
 *
 * The Swift store also caches a PublicKeyJWK per anchor — we keep that here
 * so the verifier can resolve `did:web`-style issuers that don't embed their
 * key in the DID document. Optional because pure did:key anchors derive the
 * key from the DID itself.
 */
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

import type { PublicKeyJWK } from '@solidarity/shared';

export type TrustAnchorSource = 'manual' | 'group-invite' | 'bootstrap';

export interface TrustAnchor {
  readonly did: string;
  readonly label: string;
  readonly addedAt: Date;
  readonly source: TrustAnchorSource;
  readonly publicKeyJwk?: PublicKeyJWK;
  readonly keyId?: string;
}

const KEY_PREFIX = 'trust-anchor:';

interface SerializedAnchor extends Omit<TrustAnchor, 'addedAt'> {
  readonly addedAt: string;
}

function serialize(a: TrustAnchor): SerializedAnchor {
  return { ...a, addedAt: a.addedAt.toISOString() };
}

function deserialize(s: SerializedAnchor): TrustAnchor {
  return { ...s, addedAt: new Date(s.addedAt) };
}

function normalizeDid(did: string): string {
  return did.trim().toLowerCase();
}

interface IssuerTrustAnchorState {
  readonly trusted: readonly TrustAnchor[];
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly add: (anchor: TrustAnchor) => Promise<void>;
  readonly remove: (did: string) => Promise<void>;
  readonly isTrusted: (did: string) => boolean;
  readonly lookup: (did: string, keyId?: string) => TrustAnchor | undefined;
}

export const useIssuerTrustAnchorStore = create<IssuerTrustAnchorState>((set, get) => ({
  trusted: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const out: TrustAnchor[] = [];
    for (const k of getMmkv().getAllKeys()) {
      if (!k.startsWith(KEY_PREFIX)) continue;
      const raw = getMmkv().getString(k);
      if (!raw) continue;
      try {
        const decoded = await decryptJson<SerializedAnchor>(raw);
        out.push(deserialize(decoded));
      } catch {
        // Skip corrupt entries — they'll be replaced on next add.
      }
    }
    out.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    set({ trusted: out, hydrated: true });
  },

  add: async (anchor) => {
    const normalized = normalizeDid(anchor.did);
    const next: TrustAnchor = { ...anchor, did: anchor.did, addedAt: anchor.addedAt };
    getMmkv().set(`${KEY_PREFIX}${normalized}`, await encryptJson(serialize(next)));
    set((s) => ({
      trusted: [
        next,
        ...s.trusted.filter((a) => normalizeDid(a.did) !== normalized),
      ],
    }));
  },

  remove: async (did) => {
    const normalized = normalizeDid(did);
    getMmkv().remove(`${KEY_PREFIX}${normalized}`);
    set((s) => ({
      trusted: s.trusted.filter((a) => normalizeDid(a.did) !== normalized),
    }));
  },

  isTrusted: (did) => {
    const normalized = normalizeDid(did);
    return get().trusted.some((a) => normalizeDid(a.did) === normalized);
  },

  lookup: (did, keyId) => {
    const normalized = normalizeDid(did);
    const matches = get().trusted.filter((a) => normalizeDid(a.did) === normalized);
    if (matches.length === 0) return undefined;
    if (!keyId) return matches[0];
    const exact = matches.find((m) => m.keyId === keyId);
    if (exact) return exact;
    const suffix = keyId.split('#').pop();
    if (!suffix) return matches[0];
    return matches.find((m) => m.keyId?.split('#').pop() === suffix) ?? matches[0];
  },
}));

/** Hook selector: list of trusted anchors (paint-stable, no per-render compute). */
export function useTrustAnchors(): readonly TrustAnchor[] {
  return useIssuerTrustAnchorStore((s) => s.trusted);
}

/** Test-only — wipe in-memory state. */
export function __resetIssuerTrustAnchorStoreForTesting(): void {
  useIssuerTrustAnchorStore.setState({ trusted: [], hydrated: false });
  try {
    for (const k of getMmkv().getAllKeys()) {
      if (k.startsWith(KEY_PREFIX)) getMmkv().remove(k);
    }
  } catch {
    // ignore — MMKV may not be initialised in tests
  }
}
