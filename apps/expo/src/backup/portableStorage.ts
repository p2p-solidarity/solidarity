import * as FileSystem from 'expo-file-system/legacy';
import { stableJSON, uuid, businessCardSchema, contactSchema } from '@solidarity/shared';
import { getMmkv } from '../storage/mmkv';
import { getMasterKey } from '../storage/secureMasterKey';
import { decryptJsonWithKey, encryptJsonWithKey } from '../storage/jsonCrypto';
import { canCommitLocalData, captureLocalDataEpoch } from '../settings/localDataWipeBarrier';
import type { StoredCredential } from '../credentials/store';
import type { IdentityCardEntity, ProvableClaimEntity } from '../identity/entities';
import { MAX_AVATAR_BYTES, PORTABLE_PREFERENCES, claimSchema, credentialSchema, identityCardSchema, isEncryptedPortableKey, materializePortablePage, serializePortablePage, serializePortablePreference, serializePortableProfile, validateSnapshot, type PortableData } from './portableData';
import type { Snapshot } from './syncModel';

export const SYNC_STATE_KEY = 'cloud-sync:state:v1';
const JOURNAL_KEY = 'cloud-sync:rollback:v1';
const AVATAR_KEY = 'profile:local-avatar:v1';
const AVATAR_DIR = `${FileSystem.documentDirectory ?? ''}profile-avatar/`;
const encryptedKey = isEncryptedPortableKey;
export const isPortableStorageKey = (key: string): boolean => encryptedKey(key) ||
  ['profile:v1', 'page:design:v1', AVATAR_KEY, 'prefs:v1', 'profileSnapshots:v1'].includes(key);
export let applyingPortableData = false;

type PortableStorage = ReturnType<typeof getMmkv>;

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  const value = parseJson(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid-portable-storage-record');
  }
  return value as Record<string, unknown>;
}

function gatherEncryptedRecords(
  storage: PortableStorage,
  masterKey: Uint8Array,
  records: Record<string, string>,
): void {
  for (const key of storage.getAllKeys().filter(encryptedKey).sort()) {
    const raw = storage.getString(key);
    if (raw === undefined) throw new Error('sync-local-record-changed');
    const value = decryptJsonWithKey<Record<string, unknown>>(masterKey, raw);
    // See serializeClaim: scrub the device-local field an earlier build on
    // this branch persisted, so it can never travel to another device.
    if (key.startsWith('provable:')) Reflect.deleteProperty(value, 'isPresentableOnDevice');
    records[key] = stableJSON(value);
  }
}

function gatherSingletonRecords(storage: PortableStorage, records: Record<string, string>): void {
  const profile = storage.getString('profile:v1');
  if (profile) records['profile'] = serializePortableProfile(parseJson(profile));
  const page = storage.getString('page:design:v1');
  if (page) {
    const portablePage = serializePortablePage(parseJson(page));
    if (portablePage !== undefined) records['page'] = portablePage;
  }
  const preferences = parseJsonRecord(storage.getString('prefs:v1') ?? '{}');
  for (const name of PORTABLE_PREFERENCES) {
    const value = preferences[name];
    if (value === undefined) continue;
    const portablePreference = serializePortablePreference(name, value);
    if (portablePreference !== undefined) records[`preference:${name}`] = portablePreference;
  }
}

function gatherProfileSnapshots(storage: PortableStorage, records: Record<string, string>): void {
  const snapshots = parseJsonRecord(storage.getString('profileSnapshots:v1') ?? '{}');
  for (const [key, entry] of Object.entries(snapshots)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('invalid-profile-snapshot');
    }
    const stored = entry as Record<string, unknown>;
    const normalized = { ...stored, kind: stored['kind'] ?? 'verified' };
    const id = normalized.kind === 'verified' && key.startsWith('did:') ? `full:${key}` : key;
    records[`snapshot:${id}`] = stableJSON(normalized);
  }
}

/** A stale container path (iOS restore/reinstall rewrites the app container
 * UUID), a deleted file or an oversized asset means the avatar is UNAVAILABLE
 * on this device. That is neither a snapshot failure — which would stop every
 * backup and sync — nor a deletion of the other device's avatar. */
async function gatherAvatar(
  storage: PortableStorage,
  records: Record<string, string>,
  unavailable: Set<string>,
): Promise<void> {
  const avatar = storage.getString(AVATAR_KEY);
  if (!avatar) return;
  if (!FileSystem.documentDirectory || !avatar.startsWith(AVATAR_DIR)) {
    unavailable.add('avatar');
    return;
  }
  const info = await FileSystem.getInfoAsync(avatar);
  if (!info.exists || info.isDirectory || info.size === 0 || info.size > MAX_AVATAR_BYTES) {
    unavailable.add('avatar');
    return;
  }
  const contents = await FileSystem.readAsStringAsync(avatar, { encoding: FileSystem.EncodingType.Base64 });
  records['avatar'] = JSON.stringify(contents);
}

/** Strict reads: a damaged record aborts the snapshot, never becomes a deletion.
 * Keys reported through `unavailable` are readable in principle but not from
 * this device right now; the caller carries their last reconciled value
 * forward instead of publishing their absence. */
export async function gatherPortableData(
  identity: string,
  unavailable = new Set<string>(),
): Promise<PortableData> {
  const epoch = captureLocalDataEpoch();
  const masterKey = await getMasterKey();
  const mmkv = getMmkv();
  const records: Record<string, string> = {};
  gatherEncryptedRecords(mmkv, masterKey, records);
  gatherSingletonRecords(mmkv, records);
  gatherProfileSnapshots(mmkv, records);
  await gatherAvatar(mmkv, records, unavailable);
  if (!canCommitLocalData(epoch)) throw new Error('sync-cancelled');
  validateSnapshot(records, identity);
  return { version: 1, identity, records };
}

function parseRollbackJournal(raw: string): Record<string, string | null> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  return entries.every(([, value]) => value === null || typeof value === 'string')
    ? Object.fromEntries(entries)
    : null;
}

/** Boot-time rollback before feature hydration. The journal is inside encrypted
 * MMKV. A journal that cannot be read is a rollback that can never be
 * performed: retrying it would throw out of boot on every launch, and a failed
 * boot leaves preferences at their defaults — dropping the user into
 * onboarding while their data is still on disk. Drop it instead. */
export function recoverPortableCommit(): void {
  const mmkv = getMmkv();
  const journal = mmkv.getString(JOURNAL_KEY);
  if (!journal) return;
  applyingPortableData = true;
  try {
    for (const [key, value] of Object.entries(parseRollbackJournal(journal) ?? {})) {
      if (value === null) mmkv.remove(key); else mmkv.set(key, value);
    }
    mmkv.remove(JOURNAL_KEY);
  } catch {
    // Best effort by construction. This runs before preferences hydrate, so
    // throwing would abort the rest of boot and strand the user in onboarding
    // with their data still on disk — on every launch, since a storage failure
    // here (a full disk, say) also leaves the journal in place to retry.
  } finally { applyingPortableData = false; }
}

interface WritePreparation {
  readonly storage: PortableStorage;
  readonly masterKey: Uint8Array;
  readonly writes: Record<string, string | null>;
  readonly preferences: Record<string, unknown>;
  readonly snapshots: Record<string, unknown>;
  prefsChanged: boolean;
  snapshotsChanged: boolean;
  newAvatar: string | null;
}

function invalidatePublicPageBinding(preparation: WritePreparation): void {
  preparation.preferences['publicPageBindingReady'] = false;
  preparation.preferences['publicPageRegisteredUsername'] = '';
  preparation.prefsChanged = true;
}

async function prepareRecordWrite(
  preparation: WritePreparation,
  key: string,
  value: string | undefined,
): Promise<void> {
  if (encryptedKey(key)) {
    preparation.writes[key] = value === undefined
      ? null
      : encryptJsonWithKey(preparation.masterKey, parseJson(value));
    return;
  }
  if (key === 'profile') {
    preparation.writes['profile:v1'] = value === undefined
      ? null
      : JSON.stringify({ ...parseJsonRecord(value), nostrPublishedJws: null });
    invalidatePublicPageBinding(preparation);
    return;
  }
  if (key === 'page') {
    const current = preparation.storage.getString('page:design:v1');
    preparation.writes['page:design:v1'] = JSON.stringify(materializePortablePage(
      value,
      current === undefined ? null : parseJson(current),
    ));
    return;
  }
  if (key.startsWith('preference:')) {
    const name = key.slice('preference:'.length);
    if (value === undefined) Reflect.deleteProperty(preparation.preferences, name);
    else preparation.preferences[name] = parseJson(value);
    if (name === 'publicPageUsername') invalidatePublicPageBinding(preparation);
    preparation.prefsChanged = true;
    return;
  }
  if (key.startsWith('snapshot:')) {
    const id = key.slice('snapshot:'.length);
    if (value === undefined) Reflect.deleteProperty(preparation.snapshots, id);
    else preparation.snapshots[id] = parseJson(value);
    preparation.snapshotsChanged = true;
    return;
  }
  if (key !== 'avatar') throw new Error('unsupported-sync-record');
  if (value === undefined) {
    preparation.writes[AVATAR_KEY] = null;
    return;
  }
  if (!FileSystem.documentDirectory) throw new Error('sync-avatar-unavailable');
  const contents = parseJson(value);
  if (typeof contents !== 'string') throw new Error('sync-avatar-unavailable');
  await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
  preparation.newAvatar = `${AVATAR_DIR}avatar-${uuid()}`;
  await FileSystem.writeAsStringAsync(preparation.newAvatar, contents, {
    encoding: FileSystem.EncodingType.Base64,
  });
  preparation.writes[AVATAR_KEY] = preparation.newAvatar;
}

/** Which keys an apply may touch. A sync reconciles the whole namespace, so a
 * key that is present locally but absent from the incoming set is a deletion
 * some device made. An archive import (`replace: false`) may only add and
 * update: a field the archive does not carry is unavailable, never a deletion,
 * so restoring an old cards-only backup cannot erase a newer profile. */
export function portableWriteKeys(
  before: Snapshot,
  records: Snapshot,
  replace: boolean,
): Set<string> {
  return replace
    ? new Set([...Object.keys(before), ...Object.keys(records)])
    : new Set(Object.keys(records));
}

async function prepareWrites(
  storage: PortableStorage,
  masterKey: Uint8Array,
  data: PortableData,
  before: Snapshot,
  replace: boolean,
): Promise<WritePreparation> {
  const preparation: WritePreparation = {
    storage,
    masterKey,
    writes: {},
    preferences: parseJsonRecord(storage.getString('prefs:v1') ?? '{}'),
    snapshots: parseJsonRecord(storage.getString('profileSnapshots:v1') ?? '{}'),
    prefsChanged: false,
    snapshotsChanged: false,
    newAvatar: null,
  };
  const keys = portableWriteKeys(before, data.records, replace);
  try {
    for (const key of keys) {
      const value = data.records[key];
      if (value !== before[key]) await prepareRecordWrite(preparation, key, value);
    }
  } catch (error) {
    if (preparation.newAvatar) {
      await FileSystem.deleteAsync(preparation.newAvatar, { idempotent: true }).catch(() => undefined);
    }
    throw error;
  }
  if (preparation.prefsChanged) {
    preparation.writes['prefs:v1'] = JSON.stringify(preparation.preferences);
  }
  if (preparation.snapshotsChanged) {
    preparation.writes['profileSnapshots:v1'] = JSON.stringify(preparation.snapshots);
  }
  for (const scope of ['contacts:v1', 'cards:v1', 'credentials:v1']) {
    preparation.writes[`manifest:${scope}`] = null;
  }
  return preparation;
}

/** Prepare assets/encryption asynchronously, then compare-and-commit in one JS turn.
 * A rollback journal makes process death recoverable before stores hydrate. */
export async function applyPortableData(
  data: PortableData,
  before: Snapshot,
  options: { readonly state?: string; readonly replace: boolean; readonly assertCurrent: () => void },
): Promise<void> {
  validateSnapshot(data.records, data.identity);
  const epoch = captureLocalDataEpoch();
  const masterKey = await getMasterKey();
  const mmkv = getMmkv();
  const preparation = await prepareWrites(mmkv, masterKey, data, before, options.replace);
  const { writes } = preparation;
  const oldAvatar = mmkv.getString(AVATAR_KEY);
  if (options.state !== undefined) writes[SYNC_STATE_KEY] = options.state;
  const commitState = { complete: false };
  try {
    const refresh = await prepareStoreRefresh();
    options.assertCurrent();
    if (!canCommitLocalData(epoch)) throw new Error('sync-cancelled');
    applyingPortableData = true;
    const rollback = Object.fromEntries(Object.keys(writes).map((key) => [key, mmkv.getString(key) ?? null]));
    mmkv.set(JOURNAL_KEY, JSON.stringify(rollback));
    try {
      for (const [key, value] of Object.entries(writes)) {
        if (value === null) mmkv.remove(key); else mmkv.set(key, value);
      }
      mmkv.remove(JOURNAL_KEY);
      commitState.complete = true;
    } catch (error) { recoverPortableCommit(); throw error; }
    refresh(data.records, before, options.replace);
    if (oldAvatar && oldAvatar.startsWith(AVATAR_DIR) && AVATAR_KEY in writes && writes[AVATAR_KEY] !== oldAvatar) {
      await FileSystem.deleteAsync(oldAvatar, { idempotent: true }).catch(() => undefined);
    }
  } catch (error) {
    if (preparation.newAvatar && !commitState.complete) {
      await FileSystem.deleteAsync(preparation.newAvatar, { idempotent: true }).catch(() => undefined);
    }
    throw error;
  } finally { applyingPortableData = false; }
}

function storedCredential(raw: unknown): StoredCredential {
  return credentialSchema.parse(raw);
}

function identityCard(raw: unknown): IdentityCardEntity {
  return identityCardSchema.parse(raw);
}

function provableClaim(raw: unknown): ProvableClaimEntity {
  return claimSchema.parse(raw);
}

export function inExistingOrder<T extends { readonly id: string }>(
  incoming: readonly T[],
  existing: readonly { readonly id: string }[],
): T[] {
  const remaining = new Map(incoming.map((entry) => [entry.id, entry]));
  const ordered = existing.flatMap((entry) => {
    const match = remaining.get(entry.id);
    if (!match) return [];
    remaining.delete(entry.id);
    return [match];
  });
  return [...ordered, ...remaining.values()];
}

/** Refresh immediately from the committed snapshot; invalidate earlier async hydration. */
async function prepareStoreRefresh() {
  const [contacts, cards, credentials, identity, profile, page, preferences, snapshots, cm, bm, vm] = await Promise.all([
    import('../contacts/repository'), import('../cards/cardManager'), import('../credentials/store'),
    import('../identity/dataStore'), import('../profile/store'), import('../page/pageDesignStore'),
    import('../settings/preferences'), import('../people/profileSnapshots'), import('../contacts/contactManifest'),
    import('../cards/cardManifest'), import('../credentials/credentialManifest'),
  ]);
  await page.warmPageDesignStorage();
  return (incoming: Snapshot, before: Snapshot, replace: boolean): void => {
    const all = replace ? incoming : { ...before, ...incoming };
    const values = (prefix: string): unknown[] => Object.entries(all)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => parseJson(value));
    // Record keys are sorted, but `useMyCard` is positional (manifest[0] is
    // "my own card"). Keep every already-known entry where it is and append
    // only what this refresh adds, so a sync cannot re-elect a different card.
    const existingOrder = {
      contacts: contacts.useContactStore.getState().manifest,
      cards: cards.useCardStore.getState().manifest,
      credentials: credentials.useCredentialStore.getState().manifest,
    };
    const contactList = inExistingOrder(values('contacts:').map((v) => contactSchema.parse(v)), existingOrder.contacts);
    const cardList = inExistingOrder(values('cards:').map((v) => businessCardSchema.parse(v)), existingOrder.cards);
    const credentialList = inExistingOrder(values('vc:').map(storedCredential), existingOrder.credentials);
    const identityCards = values('idcard:').map(identityCard);
    const provableClaims = values('provable:').map(provableClaim);
    contacts.useContactStore.getState().resetForLocalWipe();
    contacts.useContactStore.setState({ detailsHydrated: true, details: new Map(contactList.map((v) => [v.id, v])), manifest: contactList.map(cm.toContactManifest) });
    cards.useCardStore.getState().resetForLocalWipe();
    cards.useCardStore.setState({ detailsHydrated: true, details: new Map(cardList.map((v) => [v.id, v])), manifest: cardList.map(bm.toCardManifest) });
    credentials.useCredentialStore.getState().resetForLocalWipe();
    credentials.useCredentialStore.setState({ detailsHydrated: true, details: new Map(credentialList.map((v) => [v.id, v])), manifest: credentialList.map(vm.toCredentialManifest) });
    identity.useIdentityData.getState().resetForLocalWipe();
    identity.useIdentityData.setState({ hydrated: true, identityCards, provableClaims });
    profile.useProfileStore.getState().resetForLocalWipe();
    profile.hydrateProfile();
    page.hydratePageDesign();
    preferences.hydratePreferences();
    snapshots.useProfileSnapshotStore.getState().resetForLocalWipe();
    snapshots.hydrateProfileSnapshots();
    // Sidecars are rebuildable, but keeping them current avoids stale first paint.
    const mmkv = getMmkv();
    mmkv.set(`manifest:${cm.CONTACTS_MANIFEST_SCOPE}`, JSON.stringify(contactList.map(cm.toContactManifest)));
    mmkv.set(`manifest:${bm.CARDS_MANIFEST_SCOPE}`, JSON.stringify(cardList.map(bm.toCardManifest)));
    mmkv.set(`manifest:${vm.CREDENTIALS_MANIFEST_SCOPE}`, JSON.stringify(credentialList.map(vm.toCredentialManifest)));
  };
}
