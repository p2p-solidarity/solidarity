/**
 * BackupManager — mirrors Swift Services/Backup/BackupManager.swift.
 *
 * Bundles every locally-persisted card + contact + identity record into a
 * single encrypted blob and uploads via the active cloud provider. Restore
 * is the inverse: download → decrypt → upsert into MMKV.
 *
 * The "SOLB" magic header in the Swift impl is dropped — the blob produced
 * by encryptionManager.encryptJson already self-identifies via JSON shape,
 * and `react-native-cloud-storage` versions files implicitly by mtime.
 */
import {
  loadAllBusinessCards,
  loadAllContacts,
  saveBusinessCard,
  saveContact,
} from '../storage/storageManager';
import {
  downloadBackup,
  uploadBackup,
  type ProviderKind,
} from './cloudProvider';
import type { BusinessCard, Contact } from '@solidarity/shared';

export interface BackupPayload {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly provider: ProviderKind;
  readonly cards: readonly BusinessCard[];
  readonly contacts: readonly Contact[];
}

export interface RestoreResult {
  readonly cardsRestored: number;
  readonly contactsRestored: number;
  readonly exportedAt: string;
}

export async function performBackupNow(provider: ProviderKind): Promise<BackupPayload> {
  const [cards, contacts] = await Promise.all([
    loadAllBusinessCards(),
    loadAllContacts(),
  ]);
  const payload: BackupPayload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    provider,
    cards,
    contacts,
  };
  await uploadBackup(payload);
  return payload;
}

export async function restoreFromBackup(): Promise<RestoreResult | null> {
  const payload = await downloadBackup<BackupPayload>();
  if (!payload) return null;
  for (const card of payload.cards) await saveBusinessCard(card);
  for (const contact of payload.contacts) await saveContact(contact);
  return {
    cardsRestored: payload.cards.length,
    contactsRestored: payload.contacts.length,
    exportedAt: payload.exportedAt,
  };
}
