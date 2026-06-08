/**
 * Contact importer — mirrors Swift ContactImportService.
 *
 * Entry points:
 *   - importFromVcf(text)         — parse a .vcf paste / file pick.
 *   - loadDeviceContacts()        — request OS Contacts permission and return
 *                                    a lightweight list (id + display fields)
 *                                    for an in-app multi-select picker. No
 *                                    writes to the local repository.
 *   - importDeviceContacts(rows)  — upsert the picked rows. Used by the new
 *                                    in-app picker so the user controls what
 *                                    gets imported instead of dumping the
 *                                    entire address book.
 *   - importFromDevice()          — legacy "import everything" path, kept as a
 *                                    fallback / for tests. New UI flows use
 *                                    the picker above.
 *
 * Dedupe note: the Swift service builds a deterministic SHA-256 UUID from
 * a stable identity key (email > phone > CN identifier > name|company|title)
 * so re-running an import never produces a duplicate row. We replicate that
 * here so a user who picks the same contact twice ends up with the same
 * stored ID, not 2x copies.
 */
import * as Contacts from 'expo-contacts';

import { useContactStore } from './repository';
import { sha256 } from '@noble/hashes/sha2.js';
import { parseVCardBundle, uuid, type Contact, type ParsedVCard } from '@solidarity/shared';

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
        useZK: true,
        sharingFormat: 'zkProof',
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

interface DeviceContactDetails {
  readonly id: string;
  readonly fullName?: string | null;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly emails?: readonly { readonly address?: string }[];
  readonly phones?: readonly { readonly number?: string }[];
  readonly company?: string | null;
  readonly jobTitle?: string;
  readonly image?: string | null;
}

function deviceContactToContact(c: DeviceContactDetails): Contact | undefined {
  const composed = nilIfBlank(c.fullName ?? undefined);
  const fallback = nilIfBlank(`${c.givenName ?? ''} ${c.familyName ?? ''}`.trim());
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
        useZK: true,
        sharingFormat: 'zkProof',
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
  const picked = (await Contacts.Contact.presentPicker()) as DeviceContactDetails | null;
  if (!picked) return { granted: true, cancelled: true, count: 0 };

  const c = deviceContactToContact(picked);
  if (!c) return { granted: true, cancelled: false, count: 0 };

  await useContactStore.getState().upsert(c);
  return { granted: true, cancelled: false, count: 1 };
}

/**
 * In-app multi-select picker payload — what the picker UI lists. Mirrors the
 * fields we render in the row + the raw bag we need to re-map at import time
 * so the picker doesn't fetch the address book twice.
 */
export interface DeviceContactPickerRow {
  /** Local picker key — stable across the session, not the OS id. */
  readonly key: string;
  readonly name: string;
  readonly subtitle: string | undefined;
  readonly email: string | undefined;
  readonly phone: string | undefined;
  readonly raw: DeviceContactDetails;
}

/**
 * Tier of Contacts access the OS granted.
 *   - `'all'`     — full access; `getAllDetails()` returns the whole book.
 *   - `'limited'` — iOS 18+ partial access; only the contacts the user
 *                   hand-picked are visible. Re-prompting does nothing, so the
 *                   UI must offer `presentContactAccessPicker()` / Settings.
 *   - `'none'`    — denied or undetermined-and-refused.
 */
export type ContactAccess = 'all' | 'limited' | 'none';

/**
 * Permission-gated read of every visible device contact. Returns rows ready
 * to render in the picker plus the access tier. No repository writes — callers
 * decide which rows to upsert via `importDeviceContacts(...)`.
 *
 * `accessPrivileges === 'limited'` (iOS 18+) still reports `granted` and yields
 * only the user-selected subset; callers surface a "select more" affordance so
 * the user isn't trapped with whatever they shared first. It's `undefined` on
 * Android / pre-iOS-18, which we treat as full access.
 */
export async function loadDeviceContacts(): Promise<{
  readonly access: ContactAccess;
  readonly rows: readonly DeviceContactPickerRow[];
}> {
  const perm = await Contacts.requestPermissionsAsync();
  const granted = perm.status === Contacts.PermissionStatus.GRANTED;
  if (!granted) return { access: 'none', rows: [] };
  const access: ContactAccess = perm.accessPrivileges === 'limited' ? 'limited' : 'all';

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

  const rows: DeviceContactPickerRow[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of details.entries()) {
    const row = deviceContactPickerRow(raw, index, seen);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { access, rows };
}

function deviceContactPickerRow(
  raw: DeviceContactDetails,
  index: number,
  seen: Set<string>
): DeviceContactPickerRow | undefined {
  const composed = nilIfBlank(raw.fullName ?? undefined);
  const fallback = nilIfBlank(`${raw.givenName ?? ''} ${raw.familyName ?? ''}`.trim());
  const name = composed ?? fallback;
  if (!name) return undefined;

  const email = nilIfBlank(raw.emails?.[0]?.address);
  const phone = nilIfBlank(raw.phones?.[0]?.number);
  const company = nilIfBlank(raw.company ?? undefined);
  const title = nilIfBlank(raw.jobTitle);
  const orgLine = [company, title].filter(Boolean).join(' · ');
  const subtitle = email ?? phone ?? (orgLine.length > 0 ? orgLine : undefined);
  const key = raw.id && raw.id.length > 0 ? `cn:${raw.id}` : `idx:${String(index)}`;
  if (seen.has(key)) return undefined;

  seen.add(key);
  return { key, name, subtitle, email, phone, raw };
}

/**
 * iOS 18+ limited access: present the system contact-access sheet so the user
 * can browse their FULL address book and grant the app more contacts. The
 * newly-shared set is reflected on the next `loadDeviceContacts()` call.
 *
 * Returns the count of contacts the user added (0 if they cancelled). Only
 * meaningful when access is `'limited'`; the API is iOS 18+ only.
 */
export async function presentContactAccessPicker(): Promise<number> {
  const granted = await Contacts.Contact.presentAccessPicker();
  return granted.length;
}

/**
 * Upsert the rows the user picked. Dedupe is deterministic so re-importing
 * the same contact does not create a second row.
 */
export async function importDeviceContacts(
  rows: readonly DeviceContactPickerRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const upsert = useContactStore.getState().upsert;
  const seen = new Set<string>();
  let inserted = 0;
  for (const row of rows) {
    const c = deviceContactToContact(row.raw);
    if (!c) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    await upsert(c);
    inserted += 1;
  }
  return inserted;
}
