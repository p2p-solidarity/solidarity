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

const CARDS_PREFIX = 'cards:';
const CONTACTS_PREFIX = 'contacts:';

async function setEncrypted<T>(key: string, value: T): Promise<void> {
  getMmkv().set(key, await encryptJson(value));
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

// ----- Business cards -----

export const saveBusinessCard = (card: BusinessCard): Promise<void> =>
  setEncrypted(`${CARDS_PREFIX}${card.id}`, card);

export async function loadBusinessCard(id: string): Promise<BusinessCard | null> {
  const raw = await getEncrypted<unknown>(`${CARDS_PREFIX}${id}`);
  return raw ? businessCardSchema.parse(raw) : null;
}

export async function loadAllBusinessCards(): Promise<readonly BusinessCard[]> {
  const out: BusinessCard[] = [];
  for (const key of listKeys(CARDS_PREFIX)) {
    const raw = await getEncrypted<unknown>(key);
    if (raw) out.push(businessCardSchema.parse(raw));
  }
  return out;
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

export async function loadAllContacts(): Promise<readonly Contact[]> {
  const out: Contact[] = [];
  for (const key of listKeys(CONTACTS_PREFIX)) {
    const raw = await getEncrypted<unknown>(key);
    if (raw) out.push(contactSchema.parse(raw));
  }
  return out;
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
