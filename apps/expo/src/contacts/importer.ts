/**
 * Contact importer — mirrors Swift ContactImportService.
 *
 * Two entry points:
 *   - importFromVcf(text)     — parse a .vcf paste / file pick
 *   - importFromDevice()      — read iOS / Android Contacts framework
 *
 * Both produce `Contact` objects that go through dedup via the contact
 * repository (cardID match → merge proposal; otherwise insert). The actual
 * merge UI lands later; for now duplicates throw a typed error so the UI
 * can prompt the user.
 */
import * as Contacts from 'expo-contacts';

import { useContactStore } from './repository';
import {
  parseVCardBundle,
  type Contact,
  type ParsedVCard,
} from '@solidarity/shared';

function emailLower(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

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
      nameType: 'display_name',
      createdAt: now,
      updatedAt: now,
    },
  };
}

function deviceContactToContact(c: Contacts.Contact): Contact {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    receivedAt: now,
    source: 'Manual',
    tags: [],
    verificationStatus: 'Unverified',
    businessCard: {
      id: crypto.randomUUID(),
      name: c.name ?? '',
      title: c.jobTitle ?? undefined,
      company: c.company ?? undefined,
      email: c.emails?.[0]?.email,
      phone: c.phoneNumbers?.[0]?.number,
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

/** Pull from the OS Contacts app (with permission prompt) and insert each. */
export async function importFromDevice(): Promise<number> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return 0;
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.Emails,
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Company,
      Contacts.Fields.JobTitle,
    ],
  });
  const upsert = useContactStore.getState().upsert;
  let inserted = 0;
  const seen = new Set<string>();
  for (const c of data) {
    const key = `${c.name ?? ''}::${emailLower(c.emails?.[0]?.email)}`;
    if (seen.has(key) || !c.name) continue;
    seen.add(key);
    await upsert(deviceContactToContact(c));
    inserted++;
  }
  return inserted;
}
