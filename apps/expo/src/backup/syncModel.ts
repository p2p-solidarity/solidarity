/** Causal multi-value registers. Cloud snapshots are immutable; clocks, not
 * device wall time, decide whether an edit supersedes an earlier edit. */
export type Snapshot = Readonly<Record<string, string>>;
type Clock = Readonly<Record<string, number>>;
export interface SyncVersion {
  readonly clock: Clock;
  readonly author: string;
  readonly value: string | null;
}
export interface SyncDocument {
  readonly version: 1;
  readonly identity: string;
  readonly clock: Clock;
  readonly records: Readonly<Record<string, readonly SyncVersion[]>>;
}

export function emptySyncDocument(identity: string): SyncDocument {
  return { version: 1, identity, clock: {}, records: {} };
}
function joinClock(a: Clock, b: Clock): Clock {
  return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .map((key) => [key, Math.max(a[key] ?? 0, b[key] ?? 0)]));
}
function dominates(a: Clock, b: Clock): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.every((key) => (a[key] ?? 0) >= (b[key] ?? 0)) &&
    keys.some((key) => (a[key] ?? 0) > (b[key] ?? 0));
}
function versionId(v: SyncVersion): string {
  return JSON.stringify([v.author, Object.entries(v.clock).sort(), v.value]);
}
function compare(a: SyncVersion, b: SyncVersion): number {
  // Concurrent deletion wins, but a later explicit re-add supersedes it.
  if (a.value === null && b.value !== null) return 1;
  if (a.value !== null && b.value === null) return -1;
  const x = versionId(a), y = versionId(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function mergeDocuments(a: SyncDocument, b: SyncDocument): SyncDocument {
  if (a.identity !== b.identity) throw new Error('sync-identity-mismatch');
  const recordKeys = [...new Set([...Object.keys(a.records), ...Object.keys(b.records)])].sort();
  const records = Object.fromEntries(recordKeys.map((key) => {
    const left = Object.hasOwn(a.records, key) ? (a.records[key] ?? []) : [];
    const right = Object.hasOwn(b.records, key) ? (b.records[key] ?? []) : [];
    const versions = [...new Map([...left, ...right]
      .map((v) => [versionId(v), v])).values()];
    return [key, versions.filter((v) => !versions.some((other) => dominates(other.clock, v.clock))).sort(compare)] as const;
  }));
  return { version: 1, identity: a.identity, clock: joinClock(a.clock, b.clock), records };
}
export function materialize(doc: SyncDocument): Snapshot {
  return Object.fromEntries(Object.entries(doc.records).flatMap(([key, versions]) => {
    const winner = [...versions].sort(compare).at(-1);
    return winner && winner.value !== null ? [[key, winner.value]] : [];
  }));
}
function mintVersions(
  doc: SyncDocument,
  device: string,
  snapshot: Snapshot,
  changed: readonly string[],
): SyncDocument {
  if (!changed.length) return doc;
  const clock = { ...doc.clock, [device]: (doc.clock[device] ?? 0) + 1 };
  const records = { ...doc.records };
  for (const key of changed) records[key] = [{ clock, author: device, value: snapshot[key] ?? null }];
  return { ...doc, clock, records };
}

export function observeSnapshot(doc: SyncDocument, device: string, snapshot: Snapshot): SyncDocument {
  const previous = materialize(doc);
  return mintVersions(doc, device, snapshot, [...new Set([...Object.keys(previous), ...Object.keys(snapshot)])]
    .filter((key) => previous[key] !== snapshot[key]));
}

/** Author an explicit user choice — a restore — ON TOP of what the cloud
 * already holds, so it supersedes the peer's concurrent versions instead of
 * racing them for the device-id tie-break. Without this a restore on a device
 * with no prior sync state is a coin flip: its records carry a clock merely
 * concurrent with the peer's, and which side survives depends on two random
 * install uuids. Only the NAMED keys are adopted — a restore must never
 * publish the absence of records the archive predates. */
export function adoptRecords(
  doc: SyncDocument,
  device: string,
  snapshot: Snapshot,
  keys: readonly string[],
): SyncDocument {
  const previous = materialize(doc);
  return mintVersions(doc, device, snapshot,
    [...new Set(keys)].filter((key) => previous[key] !== snapshot[key]));
}

/** Split a snapshot into what this build understands and what it does not.
 *
 * A newer app version may publish a record type this build has never heard of.
 * Such a record has to survive untouched — carried in the document and
 * republished so the devices that DO understand it keep converging — while
 * never being written to local storage. Carrying it also keeps it out of the
 * observation: a build that published only what it understands would read the
 * unknown record as "gone from this device" and tombstone the newer device's
 * data. The portable set is explicitly meant to grow, so this is the path an
 * ordinary staged rollout takes, not an exotic one. */
export function partitionSnapshot(
  snapshot: Snapshot,
  isKnown: (key: string) => boolean,
): { readonly known: Snapshot; readonly foreign: Snapshot } {
  const known: Record<string, string> = {};
  const foreign: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (isKnown(key)) known[key] = value; else foreign[key] = value;
  }
  return { known, foreign };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

const DEVICE_ID = /^[a-zA-Z0-9-]{1,100}$/u;
/** Counters stay far below MAX_SAFE_INTEGER so that this device's own next dot
 * can never overflow into a state its own parser would later reject. */
const MAX_CLOCK_COUNT = 2 ** 40;
/** Mirrors validatePortableRecord's per-record ceiling. */
const MAX_VALUE_LENGTH = 12_000_000;

function parseClock(raw: unknown, errorCode: string): Clock {
  if (!isRecord(raw)) throw new Error(errorCode);
  const entries = Object.entries(raw);
  if (entries.length > 1000 || entries.some(([key, value]) =>
    !DEVICE_ID.test(key) || typeof value !== 'number' || !Number.isSafeInteger(value) ||
    value <= 0 || value > MAX_CLOCK_COUNT)) {
    throw new Error(errorCode);
  }
  return Object.fromEntries(entries) as Clock;
}

function parseVersion(raw: unknown, documentClock: Clock): SyncVersion {
  if (!isRecord(raw)) throw new Error('invalid-sync-version');
  const clock = parseClock(raw['clock'], 'invalid-sync-version');
  const author = raw['author'];
  const value = raw['value'];
  if (typeof author !== 'string' || !DEVICE_ID.test(author) || !Object.hasOwn(clock, author) ||
    !(value === null || (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH)) ||
    Object.entries(clock).some(([key, count]) => count > (documentClock[key] ?? 0))) {
    throw new Error('invalid-sync-version');
  }
  return { clock, author, value };
}

function parseVersions(raw: unknown, documentClock: Clock): readonly SyncVersion[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 1000) {
    throw new Error('invalid-sync-versions');
  }
  return raw.map((version) => parseVersion(version, documentClock));
}

function assertRecordKey(key: string): void {
  const reserved = key === '__proto__' || key === 'constructor' || key === 'prototype';
  const hasControlCharacter = Array.from(key).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!key || key.length > 2048 || reserved || hasControlCharacter) {
    throw new Error('invalid-sync-record-key');
  }
}

/** Validate untrusted decrypted sync metadata before any reconciliation. */
export function parseSyncDocument(raw: unknown, identity: string): SyncDocument {
  if (!isRecord(raw) || raw['version'] !== 1 || raw['identity'] !== identity || !isRecord(raw['records'])) {
    throw new Error('invalid-sync-document');
  }
  const clock = parseClock(raw['clock'], 'invalid-sync-clock');
  const recordEntries = Object.entries(raw['records']);
  if (recordEntries.length > 50_000) throw new Error('invalid-sync-clock');
  const records = Object.fromEntries(recordEntries.map(([key, versions]) => {
    assertRecordKey(key);
    return [key, parseVersions(versions, clock)] as const;
  }));
  return mergeDocuments(emptySyncDocument(identity), {
    version: 1,
    identity,
    clock,
    records,
  });
}

export interface ConflictChoice { readonly index: number; readonly value: string | null }
export interface ConflictingRecord { readonly key: string; readonly choices: readonly ConflictChoice[] }

/** Concurrent versions that carry the SAME value are not a conflict: two
 * devices restored from one backup legitimately author identical records under
 * concurrent clocks. Reporting those would bury the conflicts that do matter,
 * and they collapse on their own the next time the record is edited. */
export function conflictingRecords(doc: SyncDocument): readonly ConflictingRecord[] {
  return Object.entries(doc.records).flatMap(([key, versions]) => {
    const firstByValue = new Map<string, number>();
    versions.forEach((version, index) => {
      const identifier = version.value === null ? '\u0000deleted' : `v${version.value}`;
      if (!firstByValue.has(identifier)) firstByValue.set(identifier, index);
    });
    if (firstByValue.size < 2) return [];
    const choices = [...firstByValue.values()].sort((left, right) => left - right)
      .map((index) => ({ index, value: versions[index]?.value ?? null }));
    return [{ key, choices }];
  });
}

/** Explicit conflict resolution may choose the already-visible winner too. */
export function resolveSyncConflict(doc: SyncDocument, device: string, key: string, index: number): SyncDocument {
  const selected = doc.records[key]?.[index];
  if (!selected) throw new Error('sync-conflict-changed');
  const clock = { ...doc.clock, [device]: (doc.clock[device] ?? 0) + 1 };
  return { ...doc, clock, records: { ...doc.records, [key]: [{ clock, author: device, value: selected.value }] } };
}
