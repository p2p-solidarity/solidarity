import { expect, test } from 'bun:test';
import { validatePortableData, validatePortableRecord, isEncryptedPortableKey, materializePortablePage, serializePortablePage, serializePortablePreference } from '../../src/backup/portableData';
import { normalizeRestoredPayload } from '../../src/backup/normalizeBackupPayload';
import { createInitialPageDesign } from '../../src/page/pageDesign';

const identity = 'did:key:test';
test('complete backups preserve Page drafts and account settings; legacy absence is not a deletion', () => {
  const initialPage = createInitialPageDesign();
  const page = serializePortablePage({
    ...initialPage,
    appearance: { ...initialPage.appearance, template: 'ink' },
  });
  const data = { version: 1 as const, identity, records: {
    page: page ?? '', 'preference:publicPageUsername': JSON.stringify('gimmy'),
  } };
  const backup = normalizeRestoredPayload({ schemaVersion: 4, portableData: data });
  expect(backup?.portableData).toEqual(data);
  expect(normalizeRestoredPayload({ schemaVersion: 3, contacts: [] })?.portableData).toBeUndefined();
  expect(() => normalizeRestoredPayload({ schemaVersion: 4 })).toThrow();
});

test('wrong identity and device-owned preferences are rejected before writes', () => {
  expect(() => validatePortableData({ version: 1, identity, records: {} }, 'did:key:other')).toThrow();
  expect(() => validatePortableRecord('preference:biometricPolicy', '{}', identity)).toThrow();
  expect(() => validatePortableRecord('profile', JSON.stringify({ record: { did: identity }, jws: 'invalid', linkVisibility: [], shared: null, published: null }), identity)).toThrow();
});

test('valid credential IDs containing colons are portable; contact sidecars are not encrypted rows', () => {
  const id = 'https://issuer.example/credentials/123';
  const raw = JSON.stringify({ id, type: 'Example', title: 'A', issuerDid: 'https://issuer.example', holderDid: identity,
    trustLevel: 'L1', rawJwt: 'example', issuedAt: '2026-09-07T00:00:00Z', metadataTags: [] });
  expect(isEncryptedPortableKey(`vc:${id}`)).toBe(true);
  expect(() => validatePortableRecord(`vc:${id}`, raw, identity)).not.toThrow();
  expect(isEncryptedPortableKey('contacts:leave-cards:v1')).toBe(false);
  expect(isEncryptedPortableKey('contacts:recent-updates:v1')).toBe(false);
  expect(isEncryptedPortableKey('contacts:auto-refresh:last-sweep:v1')).toBe(false);
});

test('portable Page data omits a fresh default and device-local alert state', () => {
  const initial = createInitialPageDesign();
  expect(serializePortablePage(initial)).toBeUndefined();
  const edited = { ...initial, appearance: { ...initial.appearance, template: 'ink' as const },
    lapsedAlert: { currentSignature: 'local', dismissedSignature: 'local' } };
  const serialized = serializePortablePage(edited);
  expect(JSON.parse(serialized ?? '{}')).toEqual({ blocks: edited.blocks, appearance: edited.appearance });
});

test('applying portable Page data preserves this device alert state', () => {
  const initial = createInitialPageDesign();
  const local = { ...initial, lapsedAlert: { currentSignature: 'current', dismissedSignature: 'dismissed' } };
  const remote = serializePortablePage({ ...initial, appearance: { ...initial.appearance, template: 'ink' } });
  expect(materializePortablePage(remote, local)).toEqual({
    ...initial,
    appearance: { ...initial.appearance, template: 'ink' },
    lapsedAlert: local.lapsedAlert,
  });
  expect(materializePortablePage(undefined, local)).toEqual(local);
});

test('portable preferences omit untouched defaults but retain real choices', () => {
  expect(serializePortablePreference('shareEmail', false)).toBeUndefined();
  expect(serializePortablePreference('shareEmail', true)).toBe('true');
  expect(serializePortablePreference('shareIsHuman', true)).toBeUndefined();
  expect(serializePortablePreference('publicPageUsername', 'gimmy')).toBe('"gimmy"');
});

test('a web-signed profile with empty link visibility stays portable', async () => {
  const { serializePortableProfile } = await import('../../src/backup/portableData');
  const stored = {
    record: { did: identity, links: [{ url: 'https://a.example' }, { url: 'https://b.example' }] },
    jws: 'signature', linkVisibility: [], shared: null, published: null, nostrPublishedJws: null,
  };
  const serialized = JSON.parse(serializePortableProfile(stored)) as { linkVisibility: string[] };
  expect(serialized.linkVisibility).toEqual(['public', 'public']);
});

test('a legacy schemaVersion-3 archive converts into portable records that revalidate', async () => {
  const { legacyPortableRecords } = await import('../../src/backup/portableData');
  const timestamp = '2026-01-01T00:00:00Z';
  const businessCard = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', name: 'Swift Card', nameType: 'display_name',
    categories: [], verifiedFields: ['name'],
    sharingPreferences: { publicFields: ['name'], professionalFields: [], personalFields: [], allowForwarding: true, useZK: false, sharingFormat: 'zkProof' },
    createdAt: timestamp, updatedAt: timestamp,
  };
  const credential = {
    id: 'credential-1', type: 'profile', title: 'Profile', issuerDid: 'did:key:issuer',
    holderDid: 'did:key:holder', trustLevel: 'L1', issuedAt: timestamp, metadataTags: [],
  };
  const parsed = normalizeRestoredPayload({
    schemaVersion: 3, cards: [businessCard],
    contacts: [{ id: '550e8400-e29b-41d4-a716-446655440000', businessCard, receivedAt: timestamp, source: 'Manual' }],
    storedCredentials: [{ ...credential, rawJwt: 'jwt' }],
    identityCards: [{ ...credential, issuerType: 'self', status: 'verified', createdAt: timestamp, updatedAt: timestamp }],
    provableClaims: [{ id: 'claim-1', identityCardId: credential.id, claimType: 'profile_card', title: 'Profile',
      issuerType: 'self', trustLevel: 'L1', source: 'Profile', payload: '{}', isPresentable: true,
      createdAt: timestamp, updatedAt: timestamp }],
  });

  const legacy = legacyPortableRecords(parsed!, identity);

  // Dates and Sets must reach the record as ISO strings and arrays, not `{}`.
  expect(Object.keys(legacy.records).sort()).toEqual([
    'cards:f47ac10b-58cc-4372-a567-0e02b2c3d479',
    'contacts:550e8400-e29b-41d4-a716-446655440000',
    'idcard:credential-1',
    'provable:claim-1',
    'vc:credential-1',
  ].sort());
  expect(legacy.records['cards:f47ac10b-58cc-4372-a567-0e02b2c3d479']).toContain('"createdAt":"2026-01-01T00:00:00.000Z"');
  expect(() => validatePortableData(legacy, identity)).not.toThrow();
});

test('re-checking a verified page is an observation, not an edit', async () => {
  const { isObservationOnlyChange } = await import('../../src/backup/portableData');
  const snapshot = (verifiedAt: string, note: string | null = null) =>
    JSON.stringify({ kind: 'verified', record: { did: identity }, jws: 'sig', note, verifiedAt });

  expect(isObservationOnlyChange('snapshot:full:did:key:test',
    snapshot('2026-01-01T00:00:00Z'), snapshot('2026-06-01T00:00:00Z'))).toBe(true);
  // A real content change is still a change, even alongside a new check time.
  expect(isObservationOnlyChange('snapshot:full:did:key:test',
    snapshot('2026-01-01T00:00:00Z'), snapshot('2026-06-01T00:00:00Z', 'renamed'))).toBe(false);
  // Only verified-page snapshots get this treatment.
  expect(isObservationOnlyChange('contacts:x', '{"a":1}', '{"a":2}')).toBe(false);
});
