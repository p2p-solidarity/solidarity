import { expect, test } from 'bun:test';
import { legacyPortableRecords } from '../../src/backup/portableData';
import { normalizeRestoredPayload } from '../../src/backup/normalizeBackupPayload';

const identity = 'did:key:test';
const timestamp = '2026-01-01T00:00:00Z';

/** Whether THIS device can present a claim is answered at the presentation
 * chokepoint, never by hiding portable evidence. An earlier build on this
 * branch derived `isPresentableOnDevice` and persisted it onto claim rows; it
 * is device-local, so it must never reach another device — otherwise one
 * phone's witness state would decide what the other phone believes it holds. */
test('a device-local readiness flag never reaches a portable record', () => {
  const claim = {
    id: 'claim-1', identityCardId: 'card-1', claimType: 'age_over_18', title: 'Over 18',
    issuerType: 'self', trustLevel: 'L1', source: 'Passport', payload: '{}', isPresentable: true,
    isPresentableOnDevice: false,
    createdAt: timestamp, updatedAt: timestamp,
  };
  const parsed = normalizeRestoredPayload({ schemaVersion: 3, cards: [], contacts: [], provableClaims: [claim] });

  const record = legacyPortableRecords(parsed!, identity).records['provable:claim-1'];

  expect(record).toBeDefined();
  expect(record).not.toContain('isPresentableOnDevice');
  expect(JSON.parse(record!)).toMatchObject({ id: 'claim-1', isPresentable: true });
});
