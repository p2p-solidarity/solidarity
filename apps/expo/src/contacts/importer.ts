/**
 * Contact importer — mirrors Swift ContactImportService.
 *
 * Two entry points:
 *   - importFromVcf(text)     — parse a .vcf paste / file pick (works today)
 *   - importFromDevice()      — read iOS / Android Contacts framework
 *                                (TODO: refactor for expo-contacts v56's
 *                                 class-based Contact API; getDetails()
 *                                 must be awaited, fields moved off
 *                                 the legacy flat shape)
 */
import * as Contacts from 'expo-contacts';

import { useContactStore } from './repository';
import {
  parseVCardBundle,
  type Contact,
  type ParsedVCard,
} from '@solidarity/shared';

function vcfToContact(vc: ParsedVCard): Contact {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    receivedAt: now,
    source: 'Manual',
    tags: [],
    verificationStatus: 'Unverified',
    businessCard: {
      id: crypto.randomUUID(),
      name: vc.fullName,
      title: vc.title,
      company: vc.organization,
      email: vc.emails[0],
      phone: vc.phones[0],
      profileImage: vc.photoBase64,
      socialNetworks: [],
      skills: [],
      categories: [],
      sharingPreferences: {
        publicFields: new Set(['name']),
        professionalFields: new Set(['name', 'title', 'company', 'email']),
        personalFields: new Set(['name', 'email', 'phone']),
        allowForwarding: true,
        useZK: false,
        sharingFormat: 'didSigned',
      },
      verifiedFields: undefined,
      nameType: 'display_name',
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Parse a .vcf payload and insert every card. Returns count inserted. */
export async function importFromVcf(text: string): Promise<number> {
  const cards = parseVCardBundle(text);
  const upsert = useContactStore.getState().upsert;
  for (const vc of cards) await upsert(vcfToContact(vc));
  return cards.length;
}

/**
 * Pull from the OS Contacts app (with permission prompt).
 * Returns the granted permission state; full hydration is deferred until
 * the expo-contacts v56 class API is wired (see file header TODO).
 */
export async function importFromDevice(): Promise<{
  readonly granted: boolean;
  readonly pendingMigration: true;
}> {
  const { status } = await Contacts.requestPermissionsAsync();
  return { granted: status === 'granted', pendingMigration: true };
}
