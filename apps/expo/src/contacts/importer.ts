/**
 * Contact importer — mirrors Swift ContactImportService.
 *
 * Two entry points:
 *   - importFromVcf(text)     — parse a .vcf paste / file pick.
 *   - importFromDevice()      — request OS Contacts permission, iterate every
 *                                contact via the v56 class API
 *                                (`Contact.getAllDetails([...])`) and upsert
 *                                each into the local repository. Mirrors
 *                                Swift's "iterates all contacts on grant"
 *                                behaviour: there's no system multi-select
 *                                picker sheet on Android, so the in-app list
 *                                + dedupe is the picker.
 *
 * Dedupe note: the Swift service builds a deterministic SHA-256 UUID from
 * a stable identity key (email > phone > CN identifier > name|company|title)
 * so re-running an import never produces a duplicate row. We replicate that
 * here so a user who taps "Import from Phone" twice ends up with the same
 * contacts, not 2x copies.
 */
import * as Contacts from 'expo-contacts';

import { useContactStore } from './repository';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  parseVCardBundle,
  uuid,
  type Contact,
  type ParsedVCard,
} from '@solidarity/shared';

function vcfToContact(vc: ParsedVCard): Contact {
  const now = new Date();
  return {
    id: uuid(),
    receivedAt: now,
    source: 'Manual',
    tags: [],
    verificationStatus: 'Unverified',
    businessCard: {
      id: uuid(),
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

// --- importFromDevice helpers ---

/** Trim + collapse to nil-if-blank. Mirrors Swift `nilIfBlank()`. */
function nilIfBlank(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Build the same identity key Swift uses — email > phone > cn-id > name. */
function importedIdentityKey(input: {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly cnId?: string;
  readonly company?: string;
  readonly title?: string;
}): string {
  const email = input.email?.trim().toLowerCase();
  if (email && email.length > 0) return `email:${email}`;
  const phone = input.phone?.replace(/\D+/g, '');
  if (phone && phone.length > 0) return `phone:${phone}`;
  if (input.cnId && input.cnId.trim().length > 0) return `cn:${input.cnId.trim()}`;
  const name = input.name.trim().toLowerCase();
  const company = (input.company ?? '').trim().toLowerCase();
  const title = (input.title ?? '').trim().toLowerCase();
  return `name:${name}|company:${company}|title:${title}`;
}

/** SHA-256 → RFC 4122 v4 UUID string. Deterministic per seed. */
function deterministicUUID(seed: string): string {
  const digest = sha256(new TextEncoder().encode(seed));
  const bytes = new Uint8Array(16);
  bytes.set(digest.subarray(0, 16));
  // RFC 4122 §4.4: set version (4) and variant (10xx).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push((bytes[i] ?? 0).toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

type DeviceContactDetails = {
  readonly id: string;
  readonly fullName?: string | null;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly emails?: readonly { readonly address?: string }[];
  readonly phones?: readonly { readonly number?: string }[];
  readonly company?: string | null;
  readonly jobTitle?: string;
  readonly image?: string | null;
};

function deviceContactToContact(c: DeviceContactDetails): Contact | undefined {
  const composed = nilIfBlank(c.fullName ?? undefined);
  const fallback = nilIfBlank(
    `${c.givenName ?? ''} ${c.familyName ?? ''}`.trim()
  );
  const name = composed ?? fallback;
  if (!name) return undefined;

  const email = nilIfBlank(c.emails?.[0]?.address);
  const phone = nilIfBlank(c.phones?.[0]?.number);
  const company = nilIfBlank(c.company ?? undefined);
  const title = nilIfBlank(c.jobTitle);

  const seed = importedIdentityKey({ name, email, phone, cnId: c.id, company, title });
  const contactID = deterministicUUID(`imported|${seed}`);
  const cardID = deterministicUUID(`card|${contactID}`);
  const now = new Date();

  return {
    id: contactID,
    receivedAt: now,
    source: 'Manual',
    tags: [],
    verificationStatus: 'Unverified',
    businessCard: {
      id: cardID,
      name,
      title,
      company,
      email,
      phone,
      // expo-contacts returns a file URI in `image`; we leave the avatar
      // undefined here so the UI falls back to the initial-monogram. A
      // follow-up can wire FileSystem.readAsStringAsync → base64 transcode
      // (kept off the import path to avoid blocking on N disk reads).
      profileImage: undefined,
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

/**
 * Pull from the OS Contacts app (with permission prompt).
 * Returns the granted flag and the count of contacts inserted/refreshed.
 *
 * Dedupe is deterministic — calling this twice yields the same IDs, so the
 * repository upsert path replaces rather than appends.
 */
export async function importFromDevice(): Promise<{
  readonly granted: boolean;
  readonly count: number;
}> {
  const { status } = await Contacts.requestPermissionsAsync();
  const granted = status === Contacts.PermissionStatus.GRANTED;
  if (!granted) return { granted: false, count: 0 };

  // v56 class API. We request only the fields we map; everything else is
  // wasted work + a privacy footgun on iOS limited-access mode.
  const details = (await Contacts.Contact.getAllDetails([
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.GIVEN_NAME,
    Contacts.ContactField.FAMILY_NAME,
    Contacts.ContactField.EMAILS,
    Contacts.ContactField.PHONES,
    Contacts.ContactField.COMPANY,
    Contacts.ContactField.JOB_TITLE,
    Contacts.ContactField.IMAGE,
  ])) as readonly DeviceContactDetails[];

  const upsert = useContactStore.getState().upsert;
  const seen = new Set<string>();
  let inserted = 0;
  for (const raw of details) {
    const c = deviceContactToContact(raw);
    if (!c) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    await upsert(c);
    inserted += 1;
  }
  return { granted: true, count: inserted };
}

/**
 * Single-contact picker — mirrors the iOS CNContactPickerViewController flow
 * used by Swift v1.3.1. The user picks ONE contact at a time; tapping the
 * import button again opens the picker again. Privacy-first: we never see
 * the full address book on either platform.
 *
 * Returns the inserted count (0 if cancelled, 1 on pick).
 */
export async function importFromDevicePicker(): Promise<{
  readonly granted: boolean;
  readonly cancelled: boolean;
  readonly count: number;
}> {
  const { status } = await Contacts.requestPermissionsAsync();
  const granted = status === Contacts.PermissionStatus.GRANTED;
  if (!granted) return { granted: false, cancelled: false, count: 0 };

  // v56 class API: `Contact.presentPicker()` returns the selected contact's
  // detail bag (or null when the user cancels). The older
  // `presentContactPickerAsync` throws at runtime in v56.
  const picked = (await Contacts.Contact.presentPicker()) as
    | DeviceContactDetails
    | null;
  if (!picked) return { granted: true, cancelled: true, count: 0 };

  const c = deviceContactToContact(picked);
  if (!c) return { granted: true, cancelled: false, count: 0 };

  await useContactStore.getState().upsert(c);
  return { granted: true, cancelled: false, count: 1 };
}
