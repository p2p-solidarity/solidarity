/**
 * passBundle — builds the `pass.json` payload structure for an Apple
 * Wallet `.pkpass`, mirroring the Swift `PassKitManager.createPassData`
 * + `generateImportString` pair.
 *
 * A real `.pkpass` is a ZIP containing pass.json + manifest.json +
 * detached PKCS#7 signature + icon/logo assets. ZIP packaging + signing
 * is the responsibility of a future Nitro module (see TODOs below); this
 * module only emits the deterministic `pass.json` + the import URL.
 *
 * TODO(nitro-walletpass):
 *   1. Bundle icon.png / logo.png assets
 *   2. Compute SHA-1 manifest over each file
 *   3. Generate detached PKCS#7 signature via Apple Pass certificate
 *   4. Stream the ZIP as a Buffer → write .pkpass → PassKit.addPasses
 */
import type { BusinessCard, SharingLevel } from '@solidarity/shared';

import { filteredCardFor } from './filteredCard';

/** Hard-coded constants kept in sync with Swift `PassKitManager.swift`. */
export const PASS_TYPE_IDENTIFIER = 'pass.kidneyweakx.airmeishi.businesscard';
export const PASS_TEAM_IDENTIFIER = '538MCM44UX';
export const PASS_ORGANIZATION_NAME = 'Solid(ar)ity';
export const PASS_FORMAT_VERSION = 1;
const APP_SCHEME = 'solidarity';

interface PassField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

interface PassJson {
  readonly formatVersion: number;
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly organizationName: string;
  readonly description: string;
  readonly serialNumber: string;
  readonly logoText: string;
  readonly backgroundColor: string;
  readonly foregroundColor: string;
  readonly labelColor: string;
  readonly storeCard: {
    readonly primaryFields: readonly PassField[];
    readonly secondaryFields: readonly PassField[];
    readonly auxiliaryFields: readonly PassField[];
  };
  readonly barcodes: readonly {
    readonly format: 'PKBarcodeFormatQR';
    readonly message: string;
    readonly messageEncoding: 'iso-8859-1';
  }[];
}

/**
 * Build the `pass.json` payload for the supplied card / sharing level. The
 * output JSON is identical to what the Swift implementation would feed to
 * the server-side signer.
 */
export function buildPassJson(
  card: BusinessCard,
  sharingLevel: SharingLevel
): PassJson {
  const filtered = filteredCardFor(card, sharingLevel);
  const message = generateImportString(card, sharingLevel);

  const secondaryFields: PassField[] = [];
  if (filtered.title) {
    secondaryFields.push({ key: 'title', label: 'TITLE', value: filtered.title });
  }
  if (filtered.company) {
    secondaryFields.push({
      key: 'company',
      label: 'COMPANY',
      value: filtered.company,
    });
  }

  const auxiliaryFields: PassField[] = [];
  if (filtered.email) {
    auxiliaryFields.push({ key: 'email', label: 'EMAIL', value: filtered.email });
  }
  if (filtered.phone) {
    auxiliaryFields.push({ key: 'phone', label: 'PHONE', value: filtered.phone });
  }

  return {
    formatVersion: PASS_FORMAT_VERSION,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    teamIdentifier: PASS_TEAM_IDENTIFIER,
    organizationName: PASS_ORGANIZATION_NAME,
    description: `Business Card for ${filtered.name}`,
    serialNumber: card.id,
    logoText: PASS_ORGANIZATION_NAME,
    backgroundColor: 'rgb(0, 122, 255)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(255, 255, 255)',
    storeCard: {
      primaryFields: [
        { key: 'name', label: 'NAME', value: filtered.name },
      ],
      secondaryFields,
      auxiliaryFields,
    },
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message,
        messageEncoding: 'iso-8859-1',
      },
    ],
  };
}

/**
 * Build a `solidarity://contact?name=…&job=…` deep link, matching the Swift
 * `PassKitManager.generateImportString`. The DID query item is omitted in
 * the Expo port until the DID service ships (see `src/keychain`).
 */
export function generateImportString(
  card: BusinessCard,
  sharingLevel: SharingLevel
): string {
  const filtered = filteredCardFor(card, sharingLevel);
  const params: string[] = [];
  params.push(`name=${urlEncode(filtered.name)}`);
  params.push(`job=${urlEncode(filtered.title ?? '')}`);
  return `${APP_SCHEME}://contact?${params.join('&')}`;
}

function urlEncode(value: string): string {
  // Mirror the Swift `urlEncode` set:
  // A-Z a-z 0-9 - _ . ~ pass through; everything else percent-encoded.
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
    );
}
