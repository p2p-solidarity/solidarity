import { create } from 'zustand';
import { z } from 'zod';

import type { getMmkv as GetMmkvFn } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';
import { bytesToHex, sha256Bytes, uuid, type Contact } from '@solidarity/shared';

export const LEAVE_CARD_STORAGE_KEY = 'contacts:leave-cards:v1';

const contactValueSchema = z.string().trim().min(3).max(320).refine(
  (value) => z.email().safeParse(value).success || /^\+?[0-9][0-9 ()-]{5,24}$/.test(value),
);

const leaveCardInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contact: contactValueSchema,
  message: z.string().trim().max(1000).optional(),
  /** An opaque sender identifier for local dedupe/blocking only. It is not
   * an exchange encryption key and must never be copied into Contact.pubKey. */
  senderPublicKey: z.string().trim().min(8).max(256).optional(),
  receivedAt: z.iso.datetime().optional(),
});

export type LeaveCardInput = z.input<typeof leaveCardInputSchema>;

export interface PendingLeaveCard {
  readonly id: string;
  readonly name: string;
  readonly contact: string;
  readonly message?: string;
  readonly senderPublicKey?: string;
  readonly receivedAt: string;
  readonly identifierHash: string;
}

interface PersistedLeaveCards {
  readonly version: 1;
  readonly pending: readonly PendingLeaveCard[];
  readonly blockedIdentifiers: readonly string[];
}

const identifierHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const pendingLeaveCardSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  contact: contactValueSchema,
  message: z.string().trim().max(1000).optional(),
  senderPublicKey: z.string().trim().min(8).max(256).optional(),
  receivedAt: z.iso.datetime(),
  identifierHash: identifierHashSchema,
}).strict();
const persistedLeaveCardsSchema = z.object({
  version: z.literal(1),
  pending: z.array(pendingLeaveCardSchema),
  blockedIdentifiers: z.array(identifierHashSchema),
}).strict();

export interface LeaveCardStorage {
  readonly getString: (key: string) => string | null;
  readonly setString: (key: string, value: string) => void;
}

let cachedGetMmkv: typeof GetMmkvFn | undefined;
const defaultStorage: LeaveCardStorage = {
  getString: (key) => {
    if (!cachedGetMmkv) throw new Error('Leave Card storage is not ready.');
    return cachedGetMmkv().getString(key) ?? null;
  },
  setString: (key, value) => {
    if (!cachedGetMmkv) throw new Error('Leave Card storage is not ready.');
    cachedGetMmkv().set(key, value);
  },
};
let activeStorage = defaultStorage;

export function __setLeaveCardStorageForTesting(storage: LeaveCardStorage | null): void {
  activeStorage = storage ?? defaultStorage;
}

export async function prepareLeaveCards(): Promise<void> {
  const hydrationEpoch = captureLocalDataEpoch();
  try {
    const mod = await import('@/storage/mmkv');
    cachedGetMmkv = mod.getMmkv;
  } finally {
    if (canCommitLocalData(hydrationEpoch)) hydrateLeaveCards();
  }
}

function identifierHash(contact: string, senderPublicKey?: string): string {
  const identifier = senderPublicKey?.trim() ?? contact.trim().toLowerCase();
  return bytesToHex(sha256Bytes(identifier));
}

function initial(): PersistedLeaveCards {
  return { version: 1, pending: [], blockedIdentifiers: [] };
}

function readPersisted(raw: string): PersistedLeaveCards | null {
  try {
    const parsed = persistedLeaveCardsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function persist(value: PersistedLeaveCards): boolean {
  if (!canCommitLocalData(captureLocalDataEpoch())) return false;
  try {
    activeStorage.setString(LEAVE_CARD_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export type EnqueueResult =
  | { readonly ok: true; readonly value: PendingLeaveCard }
  | { readonly ok: false; readonly error: 'invalid' | 'blocked' | 'duplicate' | 'storage' };

interface LeaveCardState extends PersistedLeaveCards {
  readonly status: 'loading' | 'ready' | 'error';
  readonly enqueue: (input: unknown) => EnqueueResult;
  readonly accept: (id: string) => PendingLeaveCard | null;
  readonly skip: (id: string) => void;
  readonly block: (id: string) => void;
  /** Clear only live references; durable data is removed by the wipe owner. */
  readonly resetForLocalWipe: () => void;
}

const INITIAL_STATE = { ...initial(), status: 'loading' as const };

export const useLeaveCardStore = create<LeaveCardState>((set, get) => {
  const commit = (next: PersistedLeaveCards): boolean => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return false;
    if (!persist(next)) {
      set({ status: 'error' });
      return false;
    }
    set({ ...next, status: 'ready' });
    return true;
  };
  return {
    ...INITIAL_STATE,
    enqueue: (input) => {
      const parsed = leaveCardInputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: 'invalid' };
      const hash = identifierHash(parsed.data.contact, parsed.data.senderPublicKey);
      const current = get();
      if (current.blockedIdentifiers.includes(hash)) return { ok: false, error: 'blocked' };
      if (current.pending.some((card) => card.identifierHash === hash)) return { ok: false, error: 'duplicate' };
      const card: PendingLeaveCard = {
        id: uuid(),
        name: parsed.data.name,
        contact: parsed.data.contact,
        ...(parsed.data.message ? { message: parsed.data.message } : {}),
        ...(parsed.data.senderPublicKey ? { senderPublicKey: parsed.data.senderPublicKey } : {}),
        receivedAt: parsed.data.receivedAt ?? new Date().toISOString(),
        identifierHash: hash,
      };
      const saved = commit({ version: 1, pending: [...current.pending, card], blockedIdentifiers: current.blockedIdentifiers });
      return saved ? { ok: true, value: card } : { ok: false, error: 'storage' };
    },
    accept: (id) => {
      const current = get();
      const card = current.pending.find((candidate) => candidate.id === id) ?? null;
      if (!card) return null;
      return commit({ version: 1, pending: current.pending.filter((candidate) => candidate.id !== id), blockedIdentifiers: current.blockedIdentifiers })
        ? card
        : null;
    },
    skip: (id) => {
      const current = get();
      if (!current.pending.some((candidate) => candidate.id === id)) return;
      commit({ version: 1, pending: current.pending.filter((candidate) => candidate.id !== id), blockedIdentifiers: current.blockedIdentifiers });
    },
    block: (id) => {
      const current = get();
      const card = current.pending.find((candidate) => candidate.id === id);
      if (!card) return;
      commit({
        version: 1,
        pending: current.pending.filter((candidate) => candidate.id !== id),
        blockedIdentifiers: [...new Set([...current.blockedIdentifiers, card.identifierHash])],
      });
    },
    resetForLocalWipe: () => {
      set(INITIAL_STATE);
    },
  };
});

export function hydrateLeaveCards(): void {
  if (!canCommitLocalData(captureLocalDataEpoch())) return;
  try {
    const raw = activeStorage.getString(LEAVE_CARD_STORAGE_KEY);
    if (raw === null) {
      const value = initial();
      if (!persist(value)) throw new Error('write failed');
      useLeaveCardStore.setState({ ...value, status: 'ready' });
      return;
    }
    const parsed = readPersisted(raw);
    if (!parsed) {
      useLeaveCardStore.setState({ status: 'error' });
      return;
    }
    useLeaveCardStore.setState({ ...parsed, status: 'ready' });
  } catch {
    useLeaveCardStore.setState({ status: 'error' });
  }
}

/**
 * Validated ingress seam for a future public-page receiver or relay handler.
 * It deliberately accepts `unknown`: its schema check lives at this boundary,
 * before any untrusted card can reach persisted state.
 */
export function enqueueLeaveCard(input: unknown): EnqueueResult {
  return useLeaveCardStore.getState().enqueue(input);
}

function stableLeaveCardUuid(identifierHash: string, namespace: string): string {
  const hash = bytesToHex(sha256Bytes(`${namespace}:${identifierHash}`));
  const variant = ['8', '9', 'a', 'b'][Number.parseInt(hash.charAt(16), 16) % 4] ?? '8';
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

export function contactFromLeaveCard(
  card: PendingLeaveCard,
  now: Date = new Date(),
): Contact {
  const isEmail = z.email().safeParse(card.contact).success;
  return {
    // Retrying Add after the inbox cleanup write fails must upsert this same
    // contact, never mint a second row. The pending-card fingerprint is local
    // and stable for this sender/contact, so it is the idempotency key.
    id: stableLeaveCardUuid(card.identifierHash, 'contact'),
    receivedAt: now,
    source: 'Manual',
    tags: [],
    verificationStatus: 'Unverified',
    ...(card.message ? { notes: card.message } : {}),
    businessCard: {
      id: stableLeaveCardUuid(card.identifierHash, 'business-card'),
      name: card.name,
      ...(isEmail ? { email: card.contact } : { phone: card.contact }),
      socialNetworks: [],
      skills: [],
      categories: [],
      sharingPreferences: {
        publicFields: new Set(['name']),
        professionalFields: new Set(['name', 'email', 'phone']),
        personalFields: new Set(['name', 'email', 'phone']),
        allowForwarding: true,
        useZK: true,
        sharingFormat: 'zkProof',
      },
      verifiedFields: undefined,
      nameType: 'display_name',
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function resetLeaveCardStoreForTesting(): void {
  useLeaveCardStore.setState(INITIAL_STATE);
}
