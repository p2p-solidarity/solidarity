/** Explicit portable-data boundary: no keychain entries or device policy. */
import { z } from 'zod';
import { businessCardSchema, contactSchema, parseProfile, profileLinkSchema, publicPageDesignSchema, stableJSON, verifyCompact } from '@solidarity/shared';
import { createInitialPageDesign, normalizePageDesign, pageDesignFromPublicPage, publicPageDesignEquals, toPublicPageDesign, type PageDesign } from '../page/pageDesign';
import { buildProjection, normalizeLinkVisibility } from '../profile/projection';
import { jsonReplacer } from '../storage/jsonCrypto';
import type { BackupPayload } from './backupManager';
import type { Snapshot } from './syncModel';

export function isEncryptedPortableKey(key: string): boolean {
  return /^(cards|contacts|vc|idcard|provable):.+$/u.test(key) &&
    ![
      'contacts:auto-refresh:last-sweep:v1',
      'contacts:leave-cards:v1',
      'contacts:recent-updates:v1',
    ].includes(key);
}
export function isPortableRecordKey(key: string): boolean {
  return isEncryptedPortableKey(key) || ['profile', 'page', 'avatar'].includes(key) ||
    key.startsWith('snapshot:') || (key.startsWith('preference:') &&
    (PORTABLE_PREFERENCES as readonly string[]).includes(key.slice(11)));
}

const PORTABLE_PREFERENCE_DEFAULTS = {
  publicPageUsername: '',
  shareTitle: false,
  shareCompany: false,
  shareEmail: false,
  sharePhone: false,
  shareProfileImage: false,
  shareSocialNetworks: false,
  shareSkills: false,
  shareIsHuman: true,
  shareAgeOver18: false,
} as const;
type PortablePreferenceName = keyof typeof PORTABLE_PREFERENCE_DEFAULTS;
export const PORTABLE_PREFERENCES = Object.keys(PORTABLE_PREFERENCE_DEFAULTS) as PortablePreferenceName[];

function parsePortablePreference(name: string, raw: unknown): string | boolean {
  if (!Object.hasOwn(PORTABLE_PREFERENCE_DEFAULTS, name)) throw new Error('invalid-sync-preference');
  return name === 'publicPageUsername' ? z.string().max(200).parse(raw) : z.boolean().parse(raw);
}

/** Defaults are represented by absence. This lets a fresh device join without
 * manufacturing singleton conflicts, while resetting a choice creates a
 * normal CRDT deletion that converges back to the app default. */
export function serializePortablePreference(name: string, raw: unknown): string | undefined {
  const value = parsePortablePreference(name, raw);
  return value === PORTABLE_PREFERENCE_DEFAULTS[name as PortablePreferenceName]
    ? undefined
    : stableJSON(value);
}
export const portableEnvelopeSchema = z.object({
  version: z.literal(1), identity: z.string().startsWith('did:key:'),
  records: z.record(z.string(), z.string()),
}).strict();
export type PortableData = z.infer<typeof portableEnvelopeSchema>;
const INITIAL_PORTABLE_PAGE = toPublicPageDesign(createInitialPageDesign());

/** Device-only Page alert state never enters sync; an untouched default is
 * represented by absence so a freshly enrolled device cannot conflict with
 * another device's real Page edits. Resetting to default becomes a tombstone. */
export function serializePortablePage(raw: unknown): string | undefined {
  const normalized = normalizePageDesign(raw);
  if (!normalized.ok) throw new Error('invalid-page');
  const page = toPublicPageDesign(normalized.value);
  return publicPageDesignEquals(page, INITIAL_PORTABLE_PAGE) ? undefined : stableJSON(page);
}

/** Rebuild the local Page around this device's alert-dismissal state. An
 * absent portable Page means the synced value was reset to the app default. */
export function materializePortablePage(serialized: string | undefined, current: unknown): PageDesign {
  let currentPage: PageDesign;
  if (current === null) {
    currentPage = createInitialPageDesign();
  } else {
    const normalized = normalizePageDesign(current);
    if (!normalized.ok) throw new Error('invalid-page');
    currentPage = normalized.value;
  }
  const base = serialized === undefined
    ? createInitialPageDesign()
    : pageDesignFromPublicPage(publicPageDesignSchema.parse(JSON.parse(serialized)));
  return { ...base, lapsedAlert: currentPage.lapsedAlert };
}
/** One ceiling for both directions: a record this device would refuse to read
 * back must never be accepted from the cloud in the first place. */
export const MAX_AVATAR_BYTES = 8_000_000;
const MAX_AVATAR_BASE64 = Math.ceil(MAX_AVATAR_BYTES / 3) * 4;
const timestamp = z.string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value));
const trustLevel = z.enum(['L1', 'L2', 'L3', 'L3+']);
export const credentialSchema = z.object({
  id: z.string().min(1), type: z.string(), title: z.string(), issuerDid: z.string(), holderDid: z.string(),
  trustLevel, rawJwt: z.string(), issuedAt: timestamp, expiresAt: timestamp.optional(), metadataTags: z.array(z.string()),
}).loose();
export const identityCardSchema = z.object({
  id: z.string().min(1), type: z.string(), title: z.string(), issuerType: z.string(), issuerDid: z.string(),
  holderDid: z.string(), trustLevel, issuedAt: timestamp, expiresAt: timestamp.optional(), status: z.string(),
  metadataTags: z.array(z.string()), createdAt: timestamp, updatedAt: timestamp,
}).loose();
export const claimSchema = z.object({
  id: z.string().min(1), identityCardId: z.string(), claimType: z.string(), title: z.string(),
  issuerType: z.string(), trustLevel, source: z.string(), payload: z.string(), isPresentable: z.boolean(),
  createdAt: timestamp, updatedAt: timestamp, lastPresentedAt: timestamp.optional(),
}).loose();
const signedSchema = z.object({ record: z.unknown(), jws: z.string().min(1) });
function validateSigned(raw: unknown, identity?: string) {
  const pair = signedSchema.parse(raw);
  const record = parseProfile(pair.record);
  if (!record.ok || (identity !== undefined && record.value.did !== identity)) throw new Error('invalid-profile-identity');
  const verified = verifyCompact(pair.jws, record.value.did);
  if (!verified.ok || stableJSON(verified.value) !== stableJSON(record.value)) throw new Error('invalid-profile-signature');
  return record.value;
}
const profileSchema = z.object({
  record: z.unknown(), jws: z.string(),
  linkVisibility: z.array(z.enum(['public', 'link-only', 'private'])),
  shared: signedSchema.nullable(), published: signedSchema.nullable(),
});
const storedProfileSchema = z.object({
  record: z.object({ links: z.array(z.unknown()) }).loose(),
  jws: z.string(),
  linkVisibility: z.array(z.enum(['public', 'link-only', 'private'])).optional(),
  shared: signedSchema.nullable().optional(),
  published: signedSchema.nullable().optional(),
}).loose();

/** Builds before 2.0.0's webSign merge persisted `linkVisibility: []` beside a
 * record with links (the old `adoptSignedProfile` path), and only
 * `readPersisted` normalises it. Reading the raw blob without the same
 * normalisation emits a length mismatch that `validateProfileRecord` rejects —
 * which would brick backup, sync and restore for that account. */
export function serializePortableProfile(raw: unknown): string {
  const profile = storedProfileSchema.parse(raw);
  return stableJSON({
    record: profile.record,
    jws: profile.jws,
    linkVisibility: normalizeLinkVisibility(profile.record.links, profile.linkVisibility),
    shared: profile.shared ?? null,
    published: profile.published ?? null,
  });
}

function validateProfileRecord(raw: unknown, identity: string): void {
  const profile = profileSchema.parse(raw);
  const record = validateSigned(profile, identity);
  if ((record.scope ?? 'full') !== 'full' || profile.linkVisibility.length !== record.links.length) {
    throw new Error('invalid-profile-privacy');
  }
  for (const scope of ['shared', 'public'] as const) {
    const projection = scope === 'shared' ? profile.shared : profile.published;
    if (!projection) {
      // Missing projections with private links must never enable a full-record fallback.
      if (profile.linkVisibility.some((visibility) => visibility !== 'public')) {
        throw new Error('missing-private-projection');
      }
      continue;
    }
    const projected = validateSigned(projection, identity);
    if (stableJSON(projected) !== stableJSON(buildProjection({
      record,
      linkVisibility: profile.linkVisibility,
    }, scope))) {
      throw new Error('invalid-profile-projection');
    }
  }
}

function assertEntityId(key: string, prefix: string, id: string): void {
  if (key !== `${prefix}${id}`) throw new Error('invalid-sync-record-id');
}

function validateEntityRecord(key: string, raw: unknown): boolean {
  const prefix = key.slice(0, key.indexOf(':') + 1);
  if (prefix === 'cards:') {
    assertEntityId(key, prefix, businessCardSchema.parse(raw).id);
    return true;
  }
  if (prefix === 'contacts:') {
    assertEntityId(key, prefix, contactSchema.parse(raw).id);
    return true;
  }
  if (prefix === 'vc:' || prefix === 'idcard:') {
    const parsed = prefix === 'vc:' ? credentialSchema.parse(raw) : identityCardSchema.parse(raw);
    assertEntityId(key, prefix, parsed.id);
    return true;
  }
  if (prefix === 'provable:') {
    assertEntityId(key, prefix, claimSchema.parse(raw).id);
    return true;
  }
  return false;
}

function validateProfileSnapshot(key: string, raw: unknown): void {
  const entry = z.object({ kind: z.enum(['verified', 'declared']) }).loose().parse(raw);
  if (entry.kind === 'verified') {
    const record = validateSigned(raw);
    if (key !== `snapshot:${record.scope ?? 'full'}:${record.did}`) throw new Error('invalid-snapshot-id');
    const details = z.object({ verifiedAt: timestamp, note: z.string().nullable().optional(), conflicts: z.array(signedSchema).optional() }).parse(raw);
    for (const conflict of details.conflicts ?? []) validateSigned(conflict, record.did);
    return;
  }
  z.object({ sourceUrl: z.string(), title: z.string().nullable(), links: z.array(profileLinkSchema), importedAt: timestamp }).parse(raw);
  if (!/^snapshot:[0-9a-f]{24}$/u.test(key)) throw new Error('invalid-snapshot-id');
}

export function validatePortableRecord(key: string, serialized: string, identity: string): void {
  if (!isPortableRecordKey(key)) throw new Error('unsupported-sync-record');
  if (serialized.length > 12_000_000) throw new Error('sync-record-too-large');
  const raw: unknown = JSON.parse(serialized);
  if (key === 'profile') {
    validateProfileRecord(raw, identity);
    return;
  }
  if (key === 'page') {
    publicPageDesignSchema.parse(raw);
    return;
  }
  if (key === 'avatar') {
    z.string().min(1).max(MAX_AVATAR_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/u).parse(raw);
    return;
  }
  if (key.startsWith('preference:')) {
    const name = key.slice('preference:'.length);
    parsePortablePreference(name, raw);
    return;
  }
  if (validateEntityRecord(key, raw)) return;
  if (key.startsWith('snapshot:')) {
    validateProfileSnapshot(key, raw);
    return;
  }
  throw new Error('unsupported-sync-record');
}
/** Archive entities arrive zod-PARSED: `Date` objects and `Set`s, not the
 * on-disk JSON shape a portable record carries. `stableJSON` renders both as
 * `{}` — which then fails the re-validation every commit runs — so canonicalise
 * through the same replacer the storage layer writes with. */
function portableEntity(entity: unknown): string {
  return stableJSON(JSON.parse(JSON.stringify(entity, jsonReplacer)));
}

/** A pre-portable (schemaVersion 3) archive carries its records as top-level
 * arrays. Converting them into the portable record set lets one validated
 * commit path serve both archive generations. */
export function legacyPortableRecords(payload: BackupPayload, identity: string): PortableData {
  const records: Record<string, string> = {};
  for (const card of payload.cards) records[`cards:${card.id}`] = portableEntity(card);
  for (const contact of payload.contacts) records[`contacts:${contact.id}`] = portableEntity(contact);
  for (const card of payload.identityCards ?? []) records[`idcard:${card.id}`] = portableEntity(card);
  for (const claim of payload.provableClaims ?? []) {
    // An archive written by an earlier build on this branch can carry a
    // device-local readiness flag on the claim row; it must not travel.
    const portableClaim: Record<string, unknown> = { ...claim };
    Reflect.deleteProperty(portableClaim, 'isPresentableOnDevice');
    records[`provable:${claim.id}`] = portableEntity(portableClaim);
  }
  for (const credential of payload.storedCredentials ?? []) {
    records[`vc:${credential.id}`] = portableEntity(credential);
  }
  return { version: 1, identity, records };
}

/** A verified-page snapshot carries `verifiedAt` — when THIS device last
 * re-checked the page. The auto-refresh sweep rewrites it on a schedule even
 * when the signed bytes come back byte-identical, so treating that as an edit
 * mints a sync version every sweep, and two devices sweeping independently
 * turn it into a retained conflict per verified contact. The timestamp is
 * still persisted and still drives the "verified X ago" caption; it just does
 * not, on its own, mean the shared record changed. */
export function isObservationOnlyChange(key: string, previous: string, current: string): boolean {
  if (!key.startsWith('snapshot:') || previous === current) return false;
  const withoutObservation = (raw: string): string | null => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    Reflect.deleteProperty(record, 'verifiedAt');
    return stableJSON(record);
  };
  const before = withoutObservation(previous);
  return before !== null && before === withoutObservation(current);
}

export function validatePortableData(raw: unknown, identity?: string): PortableData {
  const data = portableEnvelopeSchema.parse(raw);
  if (identity !== undefined && data.identity !== identity) throw new Error('sync-identity-mismatch');
  validateSnapshot(data.records, data.identity);
  return data;
}
export function validateSnapshot(records: Snapshot, identity: string): void {
  if (Object.keys(records).length > 50_000) throw new Error('sync-too-many-records');
  for (const [key, value] of Object.entries(records)) validatePortableRecord(key, value, identity);
}
