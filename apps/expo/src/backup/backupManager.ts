/**
 * BackupManager — mirrors Swift Services/Backup/BackupManager.swift.
 *
 * Bundles every locally-persisted record into a single encrypted, SOLB-framed
 * blob and writes it as a `backup_<ts>.solbk` file via the active cloud
 * provider (iCloud Drive Documents on iOS, Drive on Android). Restore is the
 * inverse: download → decrypt → upsert into the feature stores.
 *
 * Payload parity with Swift `BackupData` v3:
 *   businessCards + contacts + identityCards + provableClaims + storedCredentials
 *
 * The "SOLB" magic header is preserved (see `solbEnvelope.ts`) so the file is
 * byte-compatible with the SwiftUI app's `.solbk` files.
 *
 * Identity / credential data is gathered and restored through the feature
 * stores via dynamic import + defensive guards: a context without native MMKV
 * (unit tests) degrades to "cards + contacts only" rather than throwing.
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
import type { IdentityCardEntity, ProvableClaimEntity } from '../identity/entities';
import type { StoredCredential } from '../credentials/store';

export interface BackupPayload {
  readonly schemaVersion: 3;
  readonly exportedAt: string;
  readonly provider: ProviderKind;
  readonly cards: readonly BusinessCard[];
  readonly contacts: readonly Contact[];
  /** Optional so a legacy v1 backup (cards + contacts only) still restores. */
  readonly identityCards?: readonly IdentityCardEntity[];
  readonly provableClaims?: readonly ProvableClaimEntity[];
  readonly storedCredentials?: readonly StoredCredential[];
}

export interface RestoreResult {
  readonly cardsRestored: number;
  readonly contactsRestored: number;
  readonly identityCardsRestored: number;
  readonly claimsRestored: number;
  readonly credentialsRestored: number;
  readonly exportedAt: string;
}

interface IdentitySnapshot {
  readonly identityCards: readonly IdentityCardEntity[];
  readonly provableClaims: readonly ProvableClaimEntity[];
  readonly storedCredentials: readonly StoredCredential[];
}

const EMPTY_IDENTITY: IdentitySnapshot = {
  identityCards: [],
  provableClaims: [],
  storedCredentials: [],
};

/** Snapshot identity cards / claims / credentials from their feature stores. */
async function gatherIdentity(): Promise<IdentitySnapshot> {
  try {
    const [{ useIdentityData }, { useCredentialStore }] = await Promise.all([
      import('../identity/dataStore'),
      import('../credentials/store'),
    ]);
    // hydrate() pulls credentials + cards + claims into memory. Idempotent;
    // throws only where native MMKV is absent (unit tests) — then we fall
    // back to whatever the in-memory state already holds.
    try {
      await useIdentityData.getState().hydrate();
    } catch {
      /* use in-memory state */
    }
    return {
      identityCards: useIdentityData.getState().identityCards,
      provableClaims: useIdentityData.getState().provableClaims,
      storedCredentials: Array.from(useCredentialStore.getState().details.values()),
    };
  } catch {
    return EMPTY_IDENTITY;
  }
}

export async function performBackupNow(provider: ProviderKind): Promise<BackupPayload> {
  const [cards, contacts, identity] = await Promise.all([
    loadAllBusinessCards(),
    loadAllContacts(),
    gatherIdentity(),
  ]);
  const payload: BackupPayload = {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    provider,
    cards,
    contacts,
    identityCards: identity.identityCards,
    provableClaims: identity.provableClaims,
    storedCredentials: identity.storedCredentials,
  };
  await uploadBackup(payload);
  return payload;
}

interface IdentityRestoreCounts {
  readonly identityCardsRestored: number;
  readonly claimsRestored: number;
  readonly credentialsRestored: number;
}

/** Restore identity cards / claims / credentials, best-effort per record. */
async function restoreIdentity(payload: BackupPayload): Promise<IdentityRestoreCounts> {
  let credentialsRestored = 0;
  let identityCardsRestored = 0;
  let claimsRestored = 0;
  try {
    const [{ useIdentityData }, { useCredentialStore }] = await Promise.all([
      import('../identity/dataStore'),
      import('../credentials/store'),
    ]);

    for (const c of payload.storedCredentials ?? []) {
      try {
        await useCredentialStore.getState().add({
          ...c,
          issuedAt: new Date(c.issuedAt),
          expiresAt: c.expiresAt ? new Date(c.expiresAt) : undefined,
        });
        credentialsRestored += 1;
      } catch {
        /* skip a single bad credential */
      }
    }
    for (const card of payload.identityCards ?? []) {
      try {
        await useIdentityData.getState().upsertIdentityCard({
          ...card,
          issuedAt: new Date(card.issuedAt),
          expiresAt: card.expiresAt ? new Date(card.expiresAt) : undefined,
          createdAt: new Date(card.createdAt),
          updatedAt: new Date(card.updatedAt),
        });
        identityCardsRestored += 1;
      } catch {
        /* skip */
      }
    }
    for (const claim of payload.provableClaims ?? []) {
      try {
        await useIdentityData.getState().upsertProvableClaim({
          ...claim,
          lastPresentedAt: claim.lastPresentedAt ? new Date(claim.lastPresentedAt) : undefined,
          createdAt: new Date(claim.createdAt),
          updatedAt: new Date(claim.updatedAt),
        });
        claimsRestored += 1;
      } catch {
        /* skip */
      }
    }
  } catch {
    // identity / credential stores unavailable in this context — cards +
    // contacts are still restored by the caller.
  }
  return { credentialsRestored, identityCardsRestored, claimsRestored };
}

export async function restoreFromBackup(): Promise<RestoreResult | null> {
  // Throws on a present-but-corrupt/undecryptable backup; null = nothing to
  // restore. The caller distinguishes the two (notFound vs error sheet).
  const payload = await downloadBackup<BackupPayload>();
  if (!payload) return null;

  for (const card of payload.cards) await saveBusinessCard(card);
  for (const contact of payload.contacts) await saveContact(contact);

  const identity = await restoreIdentity(payload);

  return {
    cardsRestored: payload.cards.length,
    contactsRestored: payload.contacts.length,
    identityCardsRestored: identity.identityCardsRestored,
    claimsRestored: identity.claimsRestored,
    credentialsRestored: identity.credentialsRestored,
    exportedAt: payload.exportedAt,
  };
}

/**
 * Lightweight probe for an existing backup — used by onboarding to offer a
 * restore before provisioning fresh keys (mirrors Swift
 * BackupManager.probeLatestBackup). Returns the latest backup's mtime, or
 * null when none exists / iCloud is unreachable.
 */
export async function probeLatestBackup(): Promise<{ timestamp: Date; isICloud: boolean } | null> {
  const { backupMtime, getActiveProvider } = await import('./cloudProvider');
  const ts = await backupMtime();
  if (!ts) return null;
  return { timestamp: ts, isICloud: getActiveProvider() === 'iCloud' };
}
