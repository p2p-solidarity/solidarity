import { withCloudDataLock } from './cloudDataLock';
import { create } from 'zustand';
import { bytesToHex, sha256Bytes, stableJSON, uuid } from '@solidarity/shared';
import { getRootDid, getPortableBackupKey } from '../identity/rootKey';
import { usePreferences } from '../settings/preferences';
import { canCommitLocalData, captureLocalDataEpoch, trackLocalDataOperation } from '../settings/localDataWipeBarrier';
import { getMmkv } from '../storage/mmkv';
import { decryptJsonWithKey, encryptJsonWithKey } from '../storage/jsonCrypto';
import { openSyncFiles, setProvider } from './cloudProvider';
import { isObservationOnlyChange, isPortableRecordKey, validatePortableRecord } from './portableData';
import { applyingPortableData, applyPortableData, gatherPortableData, isPortableStorageKey, SYNC_STATE_KEY } from './portableStorage';
import { conflictingRecords, materialize, parseSyncDocument, partitionSnapshot, type Snapshot, type SyncDocument } from './syncModel';
import { newSyncState, parseSyncState, synchronize, type SyncState } from './syncEngine';

export const useCloudSyncStatus = create<{
  status: 'idle' | 'syncing' | 'pending' | 'error'; lastCheckedAt: number | null; conflicts: number;
}>(() => ({ status: 'idle', lastCheckedAt: null, conflicts: 0 }));
let inFlight: Promise<void> | null = null;
/** Shared single flight for manual, foreground and data-change triggers. */
export function requestCloudSync(): Promise<void> {
  if (inFlight) return inFlight;
  if (!usePreferences.getState().backupEnabled) return Promise.resolve();
  const run = trackLocalDataOperation(withCloudDataLock(runSync));
  inFlight = run;
  void run.then(() => { if (inFlight === run) inFlight = null; }, () => { if (inFlight === run) inFlight = null; });
  return run;
}
/** A record this device cannot read right now is unavailable, never a
 * deletion: publishing its absence would tombstone it on the other device. */
async function currentSnapshot(
  identity: string,
  document: SyncDocument | undefined,
  unavailable = new Set<string>(),
): Promise<Snapshot> {
  const gathered = await gatherPortableData(identity, unavailable);
  const previous = document ? materialize(document) : {};
  // Records this build cannot read right now (`unavailable`) and records it
  // does not understand at all (a newer app version's) are both carried at
  // their last reconciled value. Publishing their absence would tombstone
  // them on every device.
  const foreign = partitionSnapshot(previous, isPortableRecordKey).foreign;
  const carried = [...unavailable].flatMap((key) => {
    const value = previous[key];
    return value === undefined ? [] : [[key, value] as const];
  });
  // Re-checking a verified page is an observation, not an edit. Keep the
  // reconciled value when nothing but the observation time moved, so the
  // 6-hourly sweep does not mint a version — and, on two devices sweeping
  // independently, a conflict row — for every verified contact.
  const observed = Object.entries(gathered.records).flatMap(([key, value]) => {
    const before = previous[key];
    return before !== undefined && isObservationOnlyChange(key, before, value)
      ? [[key, before] as const]
      : [];
  });
  if (unavailable.size === 0 && Object.keys(foreign).length === 0 && observed.length === 0) {
    return gathered.records;
  }
  return {
    ...gathered.records, ...foreign,
    ...Object.fromEntries(observed), ...Object.fromEntries(carried),
  };
}

async function runSync(): Promise<void> {
  const epoch = captureLocalDataEpoch();
  const provider = usePreferences.getState().backupProvider;
  const localStateChanged = { value: false };
  const subscription = getMmkv().addOnValueChangedListener((key) => {
    if (!applyingPortableData && isPortableStorageKey(key)) localStateChanged.value = true;
  });
  const assertCurrent = () => {
    if (!canCommitLocalData(epoch) || localStateChanged.value || !usePreferences.getState().backupEnabled ||
      provider !== usePreferences.getState().backupProvider) throw new Error('sync-local-state-changed');
  };
  useCloudSyncStatus.setState({ status: 'syncing' });
  try {
    const did = await getRootDid(), key = await getPortableBackupKey();
    if (!did.ok || !key.ok) throw new Error('sync-identity-unavailable');
    const checkIdentity = async () => {
      const current = await getRootDid();
      assertCurrent();
      if (!current.ok || current.value !== did.value) throw new Error('sync-identity-changed');
    };
    assertCurrent();
    setProvider(provider);
    const files = await openSyncFiles(bytesToHex(sha256Bytes(key.value)));
    const validate = (raw: unknown): SyncDocument => {
      const doc = parseSyncDocument(raw, did.value);
      for (const [recordKey, versions] of Object.entries(doc.records)) {
        // A key this build does not recognise belongs to a newer app version.
        // It is carried and republished, never written to storage, so it does
        // not need — and cannot get — a schema this build does not have.
        // Rejecting it would end every sync with that peer permanently.
        if (!isPortableRecordKey(recordKey)) continue;
        for (const version of versions) {
          // Tombstones also need an allowlisted key; unknown names never reach storage.
          if (version.value !== null) validatePortableRecord(recordKey, version.value, did.value);
        }
      }
      return doc;
    };
    let loaded: SyncState | null = null;
    const unavailable = new Set<string>();
    const document = await synchronize({
      load: () => {
        const raw = getMmkv().getString(SYNC_STATE_KEY);
        const state = raw
          ? (() => {
            const parsed = parseSyncState(JSON.parse(raw) as unknown, did.value);
            return { ...parsed, document: validate(parsed.document) };
          })()
          : newSyncState(did.value, uuid());
        loaded = state;
        return state;
      },
      snapshot: () => currentSnapshot(did.value, loaded?.document, unavailable),
      persist: (state) => { assertCurrent(); getMmkv().set(SYNC_STATE_KEY, JSON.stringify(state)); },
      pull: async () => {
        const docs: SyncDocument[] = [];
        for (const name of await files.list()) {
          assertCurrent();
          docs.push(validate(decryptJsonWithKey(key.value, await files.read(name))));
        }
        return docs;
      },
      // One revision per device, overwritten in place. A fresh id per push
      // grew the cloud without bound, and `pull` reads every revision on every
      // pass — one evicted file then fails the whole sync forever. Overwriting
      // loses nothing: a device's own document only ever grows causally.
      push: async (doc) => {
        await checkIdentity();
        await files.write(loaded?.device ?? uuid(), encryptJsonWithKey(key.value, doc));
      },
      apply: async (records, before, state) => {
        await checkIdentity();
        // A key this device could not read was carried into the snapshot so it
        // would not be published as a deletion. It is NOT present local state,
        // though: dropping it here makes the apply re-materialise it from the
        // reconciled document — otherwise a broken avatar stays broken forever
        // while its bytes sit in the very document being applied.
        const localBefore = unavailable.size === 0
          ? before
          : Object.fromEntries(Object.entries(before).filter(([key]) => !unavailable.has(key)));
        // Foreign records stay in the document and keep being republished, but
        // storage only ever sees what this build can validate and write.
        const writable = partitionSnapshot(records, isPortableRecordKey).known;
        const writableBefore = partitionSnapshot(localBefore, isPortableRecordKey).known;
        if (stableJSON(writable) === stableJSON(writableBefore)) {
          assertCurrent(); getMmkv().set(SYNC_STATE_KEY, JSON.stringify(state)); return;
        }
        await applyPortableData({ version: 1, identity: did.value, records: writable }, writableBefore,
          { state: JSON.stringify(state), replace: true, assertCurrent });
      },
      assertCurrent,
    });
    useCloudSyncStatus.setState({ status: 'idle', lastCheckedAt: Date.now(),
      conflicts: conflictingRecords(document).filter((record) => isPortableRecordKey(record.key)).length });
  } catch (error) {
    useCloudSyncStatus.setState({ status: localStateChanged.value || !canCommitLocalData(epoch) ? 'pending' : 'error' });
    throw error;
  } finally { subscription.remove(); }
}

/** Foreground polling discovers delayed iCloud delivery; local writes debounce.
 * No timers or automatic sign-in while the app is in the background. */
export function startCloudSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => { void requestCloudSync().catch(() => undefined); };
  const subscription = getMmkv().addOnValueChangedListener((key) => {
    if (applyingPortableData || !isPortableStorageKey(key)) return;
    useCloudSyncStatus.setState({ status: 'pending' });
    clearTimeout(timer);
    timer = setTimeout(run, 1500);
  });
  const interval = setInterval(run, 30_000);
  run();
  return () => { clearTimeout(timer); clearInterval(interval); subscription.remove(); };
}

export interface SyncConflictChoice {
  readonly key: string; readonly index: number; readonly summary: string; readonly digest: string;
}

/** Two versions of one contact can differ only in a field the summary does not
 * show. The choice is irreversible, so every row carries a stable digest of the
 * exact bytes it would keep. */
function conflictDigest(value: string | null): string {
  return value === null ? '—' : bytesToHex(sha256Bytes(new TextEncoder().encode(value))).slice(0, 6);
}
function conflictSummary(key: string, serialized: string | null): string {
  if (serialized === null) return 'deleted';
  if (key === 'avatar') return 'avatar';
  const value: unknown = JSON.parse(serialized);
  if (typeof value === 'boolean' || typeof value === 'string') return String(value).slice(0, 120);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return key;
  const record = value as Record<string, unknown>;
  const nested = (parent: string, field: string): unknown => {
    const child = record[parent];
    return child !== null && typeof child === 'object' && !Array.isArray(child)
      ? (child as Record<string, unknown>)[field]
      : undefined;
  };
  // A Contact carries the person's name at `businessCard.name`, so without
  // that lookup every contact conflict renders as its bare uuid key.
  const candidates = [nested('record', 'displayName'), nested('businessCard', 'name'),
    record['name'], record['title']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate.slice(0, 120);
  }
  return key;
}
export function readSyncConflicts(): { readonly revision: string; readonly choices: readonly SyncConflictChoice[] } {
  const revision = getMmkv().getString(SYNC_STATE_KEY) ?? '';
  if (!revision) return { revision, choices: [] };
  const state = JSON.parse(revision) as SyncState;
  const choices = conflictingRecords(state.document)
    // A record type this build does not understand cannot be summarised, and
    // choosing between two versions of it would republish a decision this
    // build is not equipped to make. The devices that understand it resolve it.
    .filter((record) => isPortableRecordKey(record.key))
    .flatMap((record) =>
    record.choices.map((choice) => ({
      key: record.key,
      index: choice.index,
      summary: conflictSummary(record.key, choice.value),
      digest: conflictDigest(choice.value),
    })));
  return { revision, choices };
}
export async function chooseSyncConflict(revision: string, key: string, index: number): Promise<void> {
  await withCloudDataLock(async () => {
    const { resolveSyncConflict } = await import('./syncModel');
    const epoch = captureLocalDataEpoch();
    const did = await getRootDid();
    if (!did.ok) throw new Error('sync-identity-unavailable');
    const mmkv = getMmkv();
    let changed = false;
    const sub = mmkv.addOnValueChangedListener((k) => { if (!applyingPortableData && isPortableStorageKey(k)) changed = true; });
    try {
      const assertCurrent = () => {
        if (changed || !canCommitLocalData(epoch) || mmkv.getString(SYNC_STATE_KEY) !== revision) throw new Error('sync-conflict-changed');
      };
      assertCurrent();
      const state = parseSyncState(JSON.parse(revision) as unknown, did.value);
      const doc = state.document;
      // Same unavailable-key policy as a sync pass. Re-gathering raw would
      // drop a record this device cannot read (a stale avatar path), and the
      // equality check below would then throw on every attempt — making every
      // conflict permanently unresolvable.
      const before = await currentSnapshot(did.value, doc);
      // Do not overwrite local edits that have not entered the sync model yet.
      if (stableJSON(before) !== stableJSON(materialize(doc))) throw new Error('sync-local-state-changed');
      const resolved = resolveSyncConflict(doc, state.device, key, index);
      await trackLocalDataOperation(applyPortableData({ version: 1, identity: did.value, records: materialize(resolved) }, before,
        { state: JSON.stringify({ ...state, document: resolved, unpublished: true }), replace: true, assertCurrent }));
      useCloudSyncStatus.setState({ status: 'pending', conflicts: conflictingRecords(resolved).length });
    } finally { sub.remove(); }
  });
  await requestCloudSync();
}
