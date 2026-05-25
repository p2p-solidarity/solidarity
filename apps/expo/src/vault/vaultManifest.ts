/**
 * Vault manifest — minimal non-sensitive fields the vault list needs on
 * frame 1. Stored plaintext (MMKV-encrypted, not per-blob AES) so cold
 * launch can render kind/size/date rows without decrypting each item.
 *
 * Full VaultItem (name, mimeType, checksum, encryptedPath, tags) stays
 * in the encrypted `vault:{id}` keys and is decrypted lazily on detail
 * open or via `hydrate()` in the background.
 *
 * CRITICAL PRIVACY: the filename itself can leak sensitive context
 * (e.g. `tax_return_2024.pdf`, `divorce_settlement.docx`,
 * `medical_results.pdf`). `name` therefore stays encrypted-only and is
 * NOT mirrored here. The list shows kind + size + updatedAt until
 * `hydrate()` fills in real names.
 *
 * Safe to include:
 *   - id        — opaque UUID
 *   - kind      — enum → bundled icon (no PII)
 *   - size      — file size in bytes
 *   - updatedAt — ISO timestamp string (Date → string for JSON safety)
 *
 * Excluded (kept encrypted): name, mimeType, checksumSha256,
 * encryptedPath, tags, and the file contents themselves.
 */
import type { VaultItem, VaultItemKind } from './store';

export interface VaultManifestEntry {
  readonly id: string;
  readonly kind: VaultItemKind;
  readonly size: number;
  /** ISO-8601 string; the source `updatedAt` is a `Date`. */
  readonly updatedAt: string;
}

export function toVaultManifest(item: VaultItem): VaultManifestEntry {
  return {
    id: item.id,
    kind: item.kind,
    size: item.size,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export const VAULT_MANIFEST_SCOPE = 'vault:v1';
