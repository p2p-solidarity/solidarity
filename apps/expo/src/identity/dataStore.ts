// Migration choice (a): on hydrate, mirror `useCredentialStore.items` into
// `idcard:` storage so existing data survives without a one-shot copy.
/**
 * IdentityDataStore — TS port of
 * solidarity/Services/Cache/IdentityDataStore.swift.
 *
 * Holds identity cards + provable claims (Swift SwiftData rows). Contacts
 * live in `apps/expo/src/contacts/repository.ts` — that store already
 * mirrors Swift's `ContactEntity` so we do not duplicate it here.
 *
 * Persistence: encrypted MMKV, key prefixes `idcard:` and `provable:`,
 * matching the AES-GCM blob format used by `useCredentialStore`.
 */
import { useMemo } from 'react';
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';
import {
  useCredentialStore,
  type StoredCredential,
} from '@/credentials/store';

import type {
  IdentityCardEntity,
  ProvableClaimEntity,
} from './entities';

const CARD_PREFIX = 'idcard:';
const CLAIM_PREFIX = 'provable:';
let localWipeGeneration = 0;

interface SerializedCard
  extends Omit<IdentityCardEntity, 'issuedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'> {
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SerializedClaim
  extends Omit<ProvableClaimEntity, 'lastPresentedAt' | 'createdAt' | 'updatedAt'> {
  readonly lastPresentedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function serializeCard(c: IdentityCardEntity): SerializedCard {
  return {
    ...c,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : undefined,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function deserializeCard(s: SerializedCard): IdentityCardEntity {
  return {
    ...s,
    issuedAt: new Date(s.issuedAt),
    expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  };
}

function serializeClaim(c: ProvableClaimEntity): SerializedClaim {
  return {
    ...c,
    lastPresentedAt: c.lastPresentedAt ? c.lastPresentedAt.toISOString() : undefined,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function deserializeClaim(s: SerializedClaim): ProvableClaimEntity {
  return {
    ...s,
    lastPresentedAt: s.lastPresentedAt ? new Date(s.lastPresentedAt) : undefined,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  };
}

async function writeCard(
  card: IdentityCardEntity,
  generation?: number,
  writeEpoch: LocalDataEpoch = captureLocalDataEpoch(),
): Promise<boolean> {
  if (!canCommitLocalData(writeEpoch)) return false;
  const encrypted = await encryptJson(serializeCard(card));
  if (
    (generation !== undefined && generation !== localWipeGeneration) ||
    !canCommitLocalData(writeEpoch)
  ) {
    return false;
  }
  getMmkv().set(`${CARD_PREFIX}${card.id}`, encrypted);
  return true;
}
async function writeClaim(
  claim: ProvableClaimEntity,
  generation = localWipeGeneration,
  writeEpoch: LocalDataEpoch = captureLocalDataEpoch(),
): Promise<boolean> {
  if (!canCommitLocalData(writeEpoch)) return false;
  const encrypted = await encryptJson(serializeClaim(claim));
  if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return false;
  getMmkv().set(`${CLAIM_PREFIX}${claim.id}`, encrypted);
  return true;
}

interface IdentityDataState {
  readonly identityCards: readonly IdentityCardEntity[];
  readonly provableClaims: readonly ProvableClaimEntity[];
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly upsertIdentityCard: (card: IdentityCardEntity) => Promise<void>;
  readonly removeIdentityCard: (id: string) => Promise<void>;
  readonly upsertProvableClaim: (claim: ProvableClaimEntity) => Promise<void>;
  readonly removeProvableClaim: (id: string) => Promise<void>;
  readonly markClaimPresented: (id: string) => void;
  readonly removePassportCredentials: () => Promise<void>;
  readonly clearAllIdentityData: () => Promise<void>;
  /** Drop every live reference after the encrypted local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

function deriveIssuerType(issuerDid: string): string {
  if (issuerDid.includes('gov') || issuerDid.includes('passport')) return 'government';
  if (issuerDid.includes('edu') || issuerDid.includes('institution')) return 'institution';
  return 'self';
}

function cardFromStoredCredential(v: StoredCredential): IdentityCardEntity {
  return {
    id: v.id,
    type: v.type,
    issuerType: deriveIssuerType(v.issuerDid),
    trustLevel: v.trustLevel,
    title: v.title,
    issuerDid: v.issuerDid,
    holderDid: v.holderDid,
    issuedAt: v.issuedAt,
    expiresAt: v.expiresAt,
    status: 'verified',
    rawCredentialJWT: v.rawJwt,
    metadataTags: v.metadataTags,
    createdAt: v.issuedAt,
    updatedAt: v.issuedAt,
  };
}

export const useIdentityData = create<IdentityDataState>((set, get) => ({
  identityCards: [],
  provableClaims: [],
  hydrated: false,

  hydrate: async () => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    if (get().hydrated) return;
    const cards: IdentityCardEntity[] = [];
    const claims: ProvableClaimEntity[] = [];
    for (const k of getMmkv().getAllKeys()) {
      if (k.startsWith(CARD_PREFIX)) {
        const raw = getMmkv().getString(k);
        if (!raw) continue;
        const v = await decryptJson<SerializedCard>(raw);
        if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
        cards.push(deserializeCard(v));
      } else if (k.startsWith(CLAIM_PREFIX)) {
        const raw = getMmkv().getString(k);
        if (!raw) continue;
        const v = await decryptJson<SerializedClaim>(raw);
        if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
        claims.push(deserializeClaim(v));
      }
    }

    await useCredentialStore.getState().hydrate();
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    const seen = new Set(cards.map((c) => c.id));
    for (const item of useCredentialStore.getState().details.values()) {
      if (seen.has(item.id)) continue;
      const mirrored = cardFromStoredCredential(item);
      cards.push(mirrored);
      if (!(await writeCard(mirrored, generation, writeEpoch))) return;
    }

    cards.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    claims.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    set({ identityCards: cards, provableClaims: claims, hydrated: true });
  },

  upsertIdentityCard: async (card) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!(await writeCard(card, generation, writeEpoch))) return;
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    set((s) => ({
      identityCards: [card, ...s.identityCards.filter((c) => c.id !== card.id)],
    }));
  },

  removeIdentityCard: (id) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return Promise.resolve();
    getMmkv().remove(`${CARD_PREFIX}${id}`);
    set((s) => ({ identityCards: s.identityCards.filter((c) => c.id !== id) }));
    return Promise.resolve();
  },

  upsertProvableClaim: async (claim) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!(await writeClaim(claim, generation, writeEpoch))) return;
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    set((s) => ({
      provableClaims: [claim, ...s.provableClaims.filter((c) => c.id !== claim.id)],
    }));
  },

  removeProvableClaim: (id) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return Promise.resolve();
    getMmkv().remove(`${CLAIM_PREFIX}${id}`);
    set((s) => ({ provableClaims: s.provableClaims.filter((c) => c.id !== id) }));
    return Promise.resolve();
  },

  markClaimPresented: (id) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    const claim = get().provableClaims.find((c) => c.id === id);
    if (!claim) return;
    const now = new Date();
    const next: ProvableClaimEntity = { ...claim, lastPresentedAt: now, updatedAt: now };
    void writeClaim(next, generation, writeEpoch);
    set((s) => ({
      provableClaims: s.provableClaims.map((c) => (c.id === id ? next : c)),
    }));
  },

  removePassportCredentials: async () => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    if (!get().hydrated) {
      await get().hydrate();
    }
    await useCredentialStore.getState().hydrate();
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    const credentialPassportIds = new Set<string>();
    for (const entry of useCredentialStore.getState().manifest) {
      if (entry.type === 'passport') credentialPassportIds.add(entry.id);
    }
    for (const credential of useCredentialStore.getState().details.values()) {
      if (credential.type === 'passport') credentialPassportIds.add(credential.id);
    }
    const passportCardIds = new Set(
      [
        ...get().identityCards.filter((c) => c.type === 'passport').map((c) => c.id),
        ...credentialPassportIds,
      ]
    );
    for (const id of passportCardIds) {
      if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
      getMmkv().remove(`${CARD_PREFIX}${id}`);
      await useCredentialStore.getState().remove(id);
    }
    const droppedClaimIds: string[] = [];
    for (const c of get().provableClaims) {
      if (passportCardIds.has(c.identityCardId)) {
        getMmkv().remove(`${CLAIM_PREFIX}${c.id}`);
        droppedClaimIds.push(c.id);
      }
    }
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    const dropped = new Set(droppedClaimIds);
    set((s) => ({
      identityCards: s.identityCards.filter((c) => !passportCardIds.has(c.id)),
      provableClaims: s.provableClaims.filter((c) => !dropped.has(c.id)),
    }));
  },

  clearAllIdentityData: () => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return Promise.resolve();
    for (const k of getMmkv().getAllKeys()) {
      if (k.startsWith(CARD_PREFIX) || k.startsWith(CLAIM_PREFIX)) {
        getMmkv().remove(k);
      }
    }
    get().resetForLocalWipe();
    return Promise.resolve();
  },

  resetForLocalWipe: () => {
    localWipeGeneration += 1;
    set({ identityCards: [], provableClaims: [], hydrated: true });
  },
}));

/**
 * Selector: presentable claims with `profile_card` duplicates collapsed —
 * port of Swift `IdentityDataStore.displayClaims`. The first profile_card
 * wins; everything else passes through verbatim.
 */
export function displayClaims(
  claims: readonly ProvableClaimEntity[]
): readonly ProvableClaimEntity[] {
  const out: ProvableClaimEntity[] = [];
  let profileSeen = false;
  for (const c of claims) {
    if (!c.isPresentable) continue;
    if (c.claimType === 'profile_card') {
      if (profileSeen) continue;
      profileSeen = true;
    }
    out.push(c);
  }
  return out;
}

/**
 * Hook: presentable claims, profile_card deduped — feeds the disclosures list.
 *
 * Returns a stable reference between renders when the underlying
 * `provableClaims` slice is unchanged. Selecting the raw slice (stable
 * identity from the store) and memoising the derivation in React-land
 * keeps `useSyncExternalStore`'s `getSnapshot` Object.is-stable, which
 * is required to avoid the "infinite loop" runtime error.
 */
export function useDisplayClaims(): readonly ProvableClaimEntity[] {
  const provableClaims = useIdentityData((s) => s.provableClaims);
  return useMemo(() => displayClaims(provableClaims), [provableClaims]);
}

/**
 * Hook: `true` when the holder owns at least one presentable claim of
 * `claimType`. When `holderDid` is omitted, scans the full claim set —
 * useful before the active DID is resolved. Drives the proofs section in
 * Share Settings.
 */
export function useHasClaim(claimType: string, holderDid?: string): boolean {
  return useIdentityData((s) => {
    if (holderDid === undefined) {
      return s.provableClaims.some((c) => c.isPresentable && c.claimType === claimType);
    }
    const holderCardIds = new Set(
      s.identityCards.filter((c) => c.holderDid === holderDid).map((c) => c.id)
    );
    return s.provableClaims.some(
      (c) => c.isPresentable && c.claimType === claimType && holderCardIds.has(c.identityCardId)
    );
  });
}
