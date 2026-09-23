import { base64UrlDecode } from '@solidarity/shared';
import { cborDecode } from '@solidarity/shared/qr';

/** Optional, untrusted display metadata. Never retain the attestation object. */
export function passkeyAaguid(attestationObject?: string): string | null {
  try {
    if (!attestationObject || attestationObject.length > 131072) return null;
    const decoded = cborDecode(base64UrlDecode(attestationObject));
    const authData: unknown = decoded instanceof Map ? decoded.get('authData') : null;
    if (!(authData instanceof Uint8Array) || authData.length < 55) return null;
    // Flags byte: bit 6 (AT) says attested credential data — and so an AAGUID — follows.
    const flags = authData[32] ?? 0;
    if ((flags & 0x40) === 0) return null;
    const bytes = authData.subarray(37, 53);
    if (bytes.every(byte => byte === 0)) return null;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

// Best effort: community passkey-authenticator-aaguids list; verify before release.
const PROVIDERS: Readonly<Record<string, string>> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
};

export function passkeyProvider(aaguid: string | null): string | null {
  return aaguid === null ? null : PROVIDERS[aaguid] ?? null;
}
