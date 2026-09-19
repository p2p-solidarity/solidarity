import { adoptRecords, emptySyncDocument, materialize, mergeDocuments, observeSnapshot, parseSyncDocument, type Snapshot, type SyncDocument } from './syncModel';

export interface SyncState {
  readonly device: string;
  readonly document: SyncDocument;
  readonly unpublished: boolean;
  /** Record keys an explicit restore chose. They are authored AFTER the next
   * merge so the restored content wins deterministically, then cleared in the
   * same commit that applies it. */
  readonly adopt?: readonly string[];
}
export interface SyncPorts {
  readonly load: () => SyncState;
  readonly snapshot: () => Promise<Snapshot>;
  readonly persist: (state: SyncState) => void;
  readonly pull: () => Promise<readonly SyncDocument[]>;
  readonly push: (document: SyncDocument) => Promise<void>;
  readonly apply: (snapshot: Snapshot, before: Snapshot, state: SyncState) => Promise<void>;
  readonly assertCurrent: () => void;
}
/** Local edits are durably clocked BEFORE network I/O. If another edit races
 * a upload, the next pass creates a later clock rather than reusing its dot. */
export async function synchronize(ports: SyncPorts): Promise<SyncDocument> {
  let state = ports.load();
  const snapshot = await ports.snapshot();
  ports.assertCurrent();
  const observed = observeSnapshot(state.document, state.device, snapshot);
  state = { ...state, document: observed, unpublished: state.unpublished || observed !== state.document };
  ports.persist(state);
  const remote = await ports.pull();
  ports.assertCurrent();
  let merged = observed;
  for (const document of remote) merged = mergeDocuments(merged, document);
  // A restore is the user's explicit choice of content, so it is authored on
  // top of the merge rather than concurrently with it. Its versions therefore
  // dominate the peer's and both devices converge on what was restored.
  const adopted = state.adopt?.length
    ? adoptRecords(merged, state.device, snapshot, state.adopt)
    : merged;
  if (adopted !== merged) {
    // The adoption's clock spans the merged document, so only the adopted
    // document is a valid revision to publish.
    await ports.push(adopted);
    ports.assertCurrent();
  } else if (state.unpublished) {
    await ports.push(observed);
    ports.assertCurrent();
  }
  state = { device: state.device, document: adopted, unpublished: false };
  await ports.apply(materialize(adopted), snapshot, state);
  return adopted;
}
export function newSyncState(identity: string, device: string): SyncState {
  return { device, document: emptySyncDocument(identity), unpublished: false };
}

export function parseSyncState(raw: unknown, identity: string): SyncState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid-local-sync-state');
  }
  const state = raw as Record<string, unknown>;
  const device = state['device'];
  const unpublished = state['unpublished'];
  if (typeof device !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/u.test(device) ||
    typeof unpublished !== 'boolean') {
    throw new Error('invalid-local-sync-state');
  }
  const adopt = state['adopt'];
  if (adopt !== undefined && (!Array.isArray(adopt) || adopt.length > 50_000 ||
    adopt.some((key) => typeof key !== 'string' || key.length === 0 || key.length > 2048))) {
    throw new Error('invalid-local-sync-state');
  }
  const pending = (adopt ?? []) as readonly string[];
  return {
    device,
    unpublished,
    document: parseSyncDocument(state['document'], identity),
    ...(pending.length > 0 ? { adopt: pending } : {}),
  };
}
