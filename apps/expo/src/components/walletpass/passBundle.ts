/**
 * passBundle — 1:1 port of Swift `PassKitManager` + `PassKitManager+Generation`.
 *
 * `buildPassJson`  : pass.json payload (generic pass kind) — matches
 *                    `PassKitManager.createPassData(for:sharingLevel:)`.
 * `buildAndSignPkpass`: full .pkpass orchestration —
 *   1. Build pass.json (pretty-printed, 2-space indent — matches Swift's
 *      `JSONSerialization.data(withJSONObject:options: .prettyPrinted)`).
 *   2. Bundle the placeholder logo / icon PNGs at every required scale
 *      (Swift duplicates one bitmap to logo/logo@2x/logo@3x and the same
 *      for icon — we mirror that one-byte-stream-many-aliases approach so
 *      the manifest hashes line up byte-for-byte).
 *   3. Compute the SHA-1 manifest over every file.
 *   4. POST manifest to the signing endpoint → PKCS#7 detached signature.
 *   5. STORED-method ZIP every file + manifest.json + signature → write
 *      to `<documentDirectory>/wallet/<cardId>.pkpass`.
 *
 * The Swift `createLogoImage` / `createIconImage` render text-based
 * placeholders at runtime via UIKit. There's no portable Skia/RN renderer
 * we control byte-for-byte, so the Expo port ships small PNG fixtures
 * generated once and committed under `assets/walletpass/`. They are not
 * "mock data" — they're the actual production logo + icon assets used by
 * the .pkpass that lands in Wallet.
 */
import * as FileSystem from 'expo-file-system/legacy';

import {
  bytesToHex,
  base64Decode,
  base64Encode,
  sha1Bytes,
  utf8ToBytes,
  type BusinessCard,
  type SharingLevel,
} from '@solidarity/shared';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  trackLocalDataOperation,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import {
  ANIMAL_ICON_PNG,
  DEFAULT_ICON_AT_2X_PNG,
  DEFAULT_ICON_AT_3X_PNG,
  DEFAULT_ICON_PNG,
  DEFAULT_LOGO_AT_2X_PNG,
  DEFAULT_LOGO_AT_3X_PNG,
  DEFAULT_LOGO_PNG,
} from './defaultAssets';
import { filteredCardFor } from './filteredCard';
import { buildPkpassZip, type ZipEntry } from './pkpassZip';
import { signManifest } from './passSigner';

/** Hard-coded constants kept in sync with Swift `PassKitManager.swift`. */
export const PASS_TYPE_IDENTIFIER = 'pass.kidneyweakx.airmeishi.businesscard';
export const PASS_TEAM_IDENTIFIER = '538MCM44UX';
export const PASS_ORGANIZATION_NAME = 'Solid(ar)ity';
export const PASS_FORMAT_VERSION = 1;
const APP_SCHEME = 'solidarity';
const PASS_BG_COLOR = 'rgb(33, 150, 243)';
const PASS_FG_COLOR = 'rgb(255, 255, 255)';
const PASS_LABEL_COLOR = 'rgb(255, 255, 255)';

interface PassField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

interface PassGeneric {
  readonly primaryFields: readonly PassField[];
  readonly secondaryFields: readonly PassField[];
  readonly auxiliaryFields: readonly PassField[];
  readonly backFields: readonly PassField[];
}

interface PassBarcode {
  readonly message: string;
  readonly format: 'PKBarcodeFormatQR';
  readonly messageEncoding: 'iso-8859-1';
}

export interface PassJson {
  readonly formatVersion: number;
  readonly passTypeIdentifier: string;
  readonly serialNumber: string;
  readonly teamIdentifier: string;
  readonly organizationName: string;
  readonly description: string;
  readonly logoText: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly labelColor: string;
  readonly generic: PassGeneric;
  readonly barcodes: readonly PassBarcode[];
}

export interface BuildPassOptions {
  /** Override the per-call serial (defaults to a fresh UUID). */
  readonly serialNumber?: string;
  /** Override the creation timestamp shown on the back of the pass. */
  readonly createdAt?: Date;
  /** Optional DID string to embed in the QR `did=…` query param. */
  readonly did?: string;
}

/**
 * Build the `pass.json` payload for the supplied card / sharing level.
 * Wire format is identical to `PassKitManager.createPassData`.
 */
export function buildPassJson(
  card: BusinessCard,
  sharingLevel: SharingLevel,
  options: BuildPassOptions = {}
): PassJson {
  const filtered = filteredCardFor(card, sharingLevel);
  const serial = options.serialNumber ?? generateUuid();
  const createdAt = options.createdAt ?? new Date();
  const message = generateImportString(card, sharingLevel, { did: options.did });

  const primaryFields: PassField[] = [
    { key: 'name', label: 'Name', value: filtered.name },
  ];

  const secondaryFields: PassField[] = [];
  if (filtered.title) {
    secondaryFields.push({
      key: 'title',
      label: 'Title',
      value: filtered.title,
    });
  }
  if (filtered.company) {
    secondaryFields.push({
      key: 'company',
      label: 'Company',
      value: filtered.company,
    });
  }

  const auxiliaryFields: PassField[] = [];
  if (filtered.email) {
    auxiliaryFields.push({
      key: 'email',
      label: 'Email',
      value: filtered.email,
    });
  }
  if (filtered.phone) {
    auxiliaryFields.push({
      key: 'phone',
      label: 'Phone',
      value: filtered.phone,
    });
  }

  const backFields: PassField[] = [];
  if (filtered.email) {
    backFields.push({
      key: 'email_back',
      label: 'Email',
      value: filtered.email,
    });
  }
  if (filtered.phone) {
    backFields.push({
      key: 'phone_back',
      label: 'Phone',
      value: filtered.phone,
    });
  }
  if (filtered.skills.length > 0) {
    const skillsText = filtered.skills
      .map((s) => `${s.name} (${s.proficiencyLevel})`)
      .join(', ');
    backFields.push({ key: 'skills', label: 'Skills', value: skillsText });
  }
  backFields.push({
    key: 'sharingLevel',
    label: 'Sharing Level',
    value: sharingLevelDisplayName(sharingLevel),
  });
  backFields.push({
    key: 'created',
    label: 'Created',
    value: formatCreatedAt(createdAt),
  });

  return {
    formatVersion: PASS_FORMAT_VERSION,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    serialNumber: serial,
    teamIdentifier: PASS_TEAM_IDENTIFIER,
    organizationName: PASS_ORGANIZATION_NAME,
    description: `Business Card - ${filtered.name}`,
    logoText: PASS_ORGANIZATION_NAME,
    foregroundColor: PASS_FG_COLOR,
    backgroundColor: PASS_BG_COLOR,
    labelColor: PASS_LABEL_COLOR,
    generic: { primaryFields, secondaryFields, auxiliaryFields, backFields },
    barcodes: [
      {
        message,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
  };
}

export interface BuildPkpassOptions extends BuildPassOptions {
  /**
   * Override the default logo. Applied to logo.png + logo@2x.png + logo@3x.png
   * (one byte stream reused for every scale — matches the Swift convention).
   * If omitted, the baked Solidarity wordmark (160×28 / 320×55 / 480×83) ships
   * via {@link DEFAULT_LOGO_PNG} & friends from `./defaultAssets`.
   */
  readonly logoPng?: Uint8Array;
  /**
   * Override the default icon. Applied to icon.png + icon@2x.png + icon@3x.png.
   * If omitted, the bundled sakura-on-blue glyphs at 29×29 / 58×58 / 87×87
   * are used, or — when `card.animal` is set — the matching animal avatar
   * (87×87 cropped) is reused for every scale.
   */
  readonly iconPng?: Uint8Array;
  /** Override the signing endpoint (mainly for tests / staging). */
  readonly signEndpoint?: string;
  /** Override fetch (testing). Defaults to the global runtime fetch. */
  readonly signal?: AbortSignal;
  /** Skip writing to disk — return the .pkpass bytes only. */
  readonly inMemoryOnly?: boolean;
}

export interface PkpassResult {
  readonly fileUri: string | undefined;
  readonly pkpassBytes: Uint8Array;
  readonly manifest: Readonly<Record<string, string>>;
  readonly signatureBytes: Uint8Array;
  readonly passJson: PassJson;
}

/**
 * Build a complete signed .pkpass for the given card + sharing level.
 *
 * Flow (1:1 with Swift `createPassBundle`):
 *   1. JSON-serialize pass.json (pretty-printed UTF-8)
 *   2. Collect logo/logo@2x/logo@3x + icon/icon@2x/icon@3x; if the card
 *      has a profile image, also add thumbnail / thumbnail@2x.
 *   3. Compute SHA-1 of every entry → manifest.json
 *   4. POST manifest to the signer → PKCS#7 detached signature bytes
 *   5. ZIP everything into a single STORED archive
 *   6. (default) Persist under `documentDirectory/wallet/<cardId>.pkpass`
 */
export async function buildAndSignPkpass(
  card: BusinessCard,
  sharingLevel: SharingLevel,
  options: BuildPkpassOptions = {}
): Promise<PkpassResult> {
  const passJson = buildPassJson(card, sharingLevel, options);
  const passJsonBytes = utf8ToBytes(prettyJson(passJson));

  // Per-scale defaults. A caller override (`logoPng` / `iconPng`) reuses one
  // byte stream for every scale alias — same convention as the Swift side
  // (PassKitManager+Generation renders one bitmap and writes it three times).
  // When no override is supplied we ship the bundled, correctly-dimensioned
  // PNGs from `./defaultAssets` (sakura icon, wordmark logo). When the card
  // has an `animal`, the matching avatar (87×87) is used for every icon
  // scale — mirrors the Swift "remember-the-pig" UX in BusinessCard.swift.
  const animalIconBytes =
    card.animal !== undefined ? ANIMAL_ICON_PNG[card.animal] : undefined;
  const iconPng = options.iconPng ?? animalIconBytes ?? DEFAULT_ICON_PNG;
  const iconAt2x = options.iconPng ?? animalIconBytes ?? DEFAULT_ICON_AT_2X_PNG;
  const iconAt3x = options.iconPng ?? animalIconBytes ?? DEFAULT_ICON_AT_3X_PNG;
  const logoPng = options.logoPng ?? DEFAULT_LOGO_PNG;
  const logoAt2x = options.logoPng ?? DEFAULT_LOGO_AT_2X_PNG;
  const logoAt3x = options.logoPng ?? DEFAULT_LOGO_AT_3X_PNG;

  const filtered = filteredCardFor(card, sharingLevel);
  const profileImageBytes = filtered.profileImage
    ? safeBase64ToBytes(filtered.profileImage)
    : undefined;

  const assetEntries: ZipEntry[] = [
    { name: 'pass.json', data: passJsonBytes },
    { name: 'logo.png', data: logoPng },
    { name: 'logo@2x.png', data: logoAt2x },
    { name: 'logo@3x.png', data: logoAt3x },
    { name: 'icon.png', data: iconPng },
    { name: 'icon@2x.png', data: iconAt2x },
    { name: 'icon@3x.png', data: iconAt3x },
  ];
  if (profileImageBytes) {
    assetEntries.push(
      { name: 'thumbnail.png', data: profileImageBytes },
      { name: 'thumbnail@2x.png', data: profileImageBytes }
    );
  }

  const manifest: Record<string, string> = {};
  for (const entry of assetEntries) {
    manifest[entry.name] = bytesToHex(sha1Bytes(entry.data));
  }
  const manifestBytes = utf8ToBytes(prettyJson(manifest));

  const signatureBytes = await signManifest(manifestBytes, {
    endpoint: options.signEndpoint,
    signal: options.signal,
  });

  // ZIP order matches Swift: pass.json, manifest, signature, then assets.
  const zipEntries: ZipEntry[] = [
    { name: 'pass.json', data: passJsonBytes },
    { name: 'manifest.json', data: manifestBytes },
    { name: 'signature', data: signatureBytes },
    { name: 'logo.png', data: logoPng },
    { name: 'logo@2x.png', data: logoAt2x },
    { name: 'logo@3x.png', data: logoAt3x },
    { name: 'icon.png', data: iconPng },
    { name: 'icon@2x.png', data: iconAt2x },
    { name: 'icon@3x.png', data: iconAt3x },
  ];
  if (profileImageBytes) {
    zipEntries.push(
      { name: 'thumbnail.png', data: profileImageBytes },
      { name: 'thumbnail@2x.png', data: profileImageBytes }
    );
  }

  const pkpassBytes = buildPkpassZip(zipEntries);

  let fileUri: string | undefined;
  if (!options.inMemoryOnly) {
    fileUri = await persistPkpass(card.id, pkpassBytes);
  }

  return { fileUri, pkpassBytes, manifest, signatureBytes, passJson };
}

/**
 * Build a `solidarity://contact?name=…&job=…[&did=…]` deep link, matching
 * the Swift `PassKitManager.generateImportString`. The `did` query item
 * is appended only when the caller passes one in.
 */
export function generateImportString(
  card: BusinessCard,
  sharingLevel: SharingLevel,
  options: { readonly did?: string } = {}
): string {
  const filtered = filteredCardFor(card, sharingLevel);
  const params: string[] = [];
  params.push(`name=${urlEncode(filtered.name)}`);
  params.push(`job=${urlEncode(filtered.title ?? '')}`);
  if (options.did) {
    params.push(`did=${urlEncode(options.did)}`);
  }
  return `${APP_SCHEME}://contact?${params.join('&')}`;
}

// ── internals ──────────────────────────────────────────────────────────────

function urlEncode(value: string): string {
  // Mirror the Swift `urlEncode` set:
  // A-Z a-z 0-9 - _ . ~ pass through; everything else percent-encoded.
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

function generateUuid(): string {
  // Avoid pulling crypto.randomUUID (not always available in RN). Mirrors
  // the format Swift's `UUID().uuidString` produces.
  const bytes = new Uint8Array(16);
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array };
  };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes).toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sharingLevelDisplayName(level: SharingLevel): string {
  switch (level) {
    case 'public':
      return 'Public';
    case 'professional':
      return 'Professional';
    case 'personal':
      return 'Personal';
  }
}

function formatCreatedAt(date: Date): string {
  // Matches Swift DateFormatter(.medium, .short) for the en_US locale —
  // e.g. "May 24, 2026 at 10:32 AM". Intl is available in RN Hermes.
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function prettyJson(value: unknown): string {
  // Swift `JSONSerialization.data(.prettyPrinted)` uses 2-space indent and
  // a trailing newline; JSON.stringify with indent=2 omits the newline.
  // Apple's verifier accepts either; we match Swift to be byte-equal.
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeBase64ToBytes(b64: string): Uint8Array | undefined {
  try {
    return base64Decode(b64);
  } catch {
    return undefined;
  }
}

function persistPkpass(
  cardId: string,
  bytes: Uint8Array
): Promise<string> {
  return trackLocalDataOperation(
    persistPkpassAtEpoch(cardId, bytes, captureLocalDataEpoch()),
  );
}

async function persistPkpassAtEpoch(
  cardId: string,
  bytes: Uint8Array,
  writeEpoch: LocalDataEpoch,
): Promise<string> {
  if (!canCommitLocalData(writeEpoch)) {
    throw new Error('Wallet pass write was invalidated by a local data wipe.');
  }
  const docDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!docDir) {
    throw new Error('No writable directory available for pkpass output.');
  }
  const walletDir = `${docDir}wallet/`;
  const info = await FileSystem.getInfoAsync(walletDir);
  if (!canCommitLocalData(writeEpoch)) {
    throw new Error('Wallet pass write was invalidated by a local data wipe.');
  }
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(walletDir, { intermediates: true });
    if (!canCommitLocalData(writeEpoch)) {
      throw new Error('Wallet pass write was invalidated by a local data wipe.');
    }
  }
  const fileUri = `${walletDir}${cardId}.pkpass`;
  // expo-file-system writes the raw decoded bytes when given a standard
  // (padded) base64 string — base64Encode from @solidarity/shared emits
  // padded standard base64 (alphabet '+'/'/'), which is exactly what the
  // FS layer expects for non-UTF8 payloads.
  await FileSystem.writeAsStringAsync(fileUri, base64Encode(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!canCommitLocalData(writeEpoch)) {
    throw new Error('Wallet pass write was invalidated by a local data wipe.');
  }
  return fileUri;
}
