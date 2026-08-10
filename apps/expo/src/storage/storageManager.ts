/**
 * Typed encrypted storage — mirrors solidarity/Services/Utils/
 * StorageManager.swift's save/load business cards / contacts / preferences.
 *
 * Backing store: MMKV (sync, native, memory-mapped) with at-rest AES
 * derived from our master key. Values are JSON-serialised then sealed
 * via `encryptionManager.encryptJson` so the wire matches Swift exactly
 * for cross-app interoperability (e.g. App Clip handoff).
 *
 * Keys are namespaced (`cards:`, `contacts:`, `prefs:`, `vc:`) so list +
 * delete-by-prefix stays cheap.
 */
import {
  businessCardSchema,
  contactSchema,
  type BusinessCard,
  type Contact,
} from '@solidarity/shared';

import { decryptJson, encryptJson } from './encryptionManager';
import { getMmkv } from './mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

const CARDS_PREFIX = 'cards:';
const CONTACTS_PREFIX = 'contacts:';

async function setEncrypted<T>(key: string, value: T): Promise<void> {
  const writeEpoch = captureLocalDataEpoch();
  if (!canCommitLocalData(writeEpoch)) return;
  const encrypted = await encryptJson(value);
  if (!canCommitLocalData(writeEpoch)) return;
  getMmkv().set(key, encrypted);
}

async function getEncrypted<T>(key: string): Promise<T | null> {
  const blob = getMmkv().getString(key);
  return blob ? await decryptJson<T>(blob) : null;
}

function listKeys(prefix: string): readonly string[] {
  return getMmkv()
    .getAllKeys()
    .filter((k) => k.startsWith(prefix));
}

/**
 * Tolerant bulk-load. A single corrupt record (e.g. a schema-incompatible
 * leftover from a prior app version) used to throw and wipe the entire
 * list — `loadAllBusinessCards()` rejecting meant the cards store stayed
 * empty forever after upgrade. Here we skip the bad key, log in dev, and
 * return everything that parses cleanly.
 */
async function loadAllEncrypted<T>(
  prefix: string,
  parse: (raw: unknown) => T,
): Promise<readonly T[]> {
  const out: T[] = [];
  for (const key of listKeys(prefix)) {
    try {
      const raw = await getEncrypted<unknown>(key);
      if (raw) out.push(parse(raw));
    } catch (err) {
      if (__DEV__) {
        console.warn(`[storageManager] skipping corrupt record ${key}:`, err);
      }
    }
  }
  return out;
}

// ----- Business cards -----

export const saveBusinessCard = (card: BusinessCard): Promise<void> =>
  setEncrypted(`${CARDS_PREFIX}${card.id}`, card);

export async function loadBusinessCard(id: string): Promise<BusinessCard | null> {
  const raw = await getEncrypted<unknown>(`${CARDS_PREFIX}${id}`);
  return raw ? businessCardSchema.parse(raw) : null;
}

export function loadAllBusinessCards(): Promise<readonly BusinessCard[]> {
  return loadAllEncrypted(CARDS_PREFIX, (r) => businessCardSchema.parse(r));
}

/** True if any encrypted card record exists. Used by manifest migration. */
export function hasAnyBusinessCard(): boolean {
  return listKeys(CARDS_PREFIX).length > 0;
}

export function deleteBusinessCard(id: string): void {
  getMmkv().remove(`${CARDS_PREFIX}${id}`);
}

// ----- Contacts -----

export const saveContact = (contact: Contact): Promise<void> =>
  setEncrypted(`${CONTACTS_PREFIX}${contact.id}`, contact);

export async function loadContact(id: string): Promise<Contact | null> {
  const raw = await getEncrypted<unknown>(`${CONTACTS_PREFIX}${id}`);
  return raw ? contactSchema.parse(raw) : null;
}

export function loadAllContacts(): Promise<readonly Contact[]> {
  return loadAllEncrypted(CONTACTS_PREFIX, (r) => contactSchema.parse(r));
}

/** True if any encrypted contact record exists. Used by manifest migration. */
export function hasAnyContact(): boolean {
  return listKeys(CONTACTS_PREFIX).length > 0;
}

export function deleteContact(id: string): void {
  getMmkv().remove(`${CONTACTS_PREFIX}${id}`);
}

// ----- Bulk -----

/** Wipe ALL keys. Mirrors Swift StorageManager.clearAllData(). */
export function clearAllData(): void {
  getMmkv().clearAll();
}

/** Approx total bytes used (sum of value sizes). */
export function getStorageSize(): number {
  let total = 0;
  for (const key of getMmkv().getAllKeys()) {
    total += getMmkv().getString(key)?.length ?? 0;
  }
  return total;
}
