/**
 * Show-witness vault (spec:
 * docs/superpowers/specs/2026-06-12-passport-show-presentation-design.md).
 *
 * Persists the OpenAC v3 witness bundle at enrollment so every later
 * presentation can prove a FRESH `openac_show` (new nonce, today's date,
 * per-presentation disclosure) without re-reading the passport chip.
 *
 * The bundle contains the commitment opening (claims field, link_rand,
 * hash halves, device pk) — secrets that must never leave the device. They
 * are AES-GCM wrapped via `encryptJson` and stored inside the already
 * master-key-encrypted MMKV instance.
 *
 * The same module records the vk self-pin: sha256 of the `openac_show` vk
 * this device produced at its own enrollment. The verifier path uses it as
 * a trust-on-first-use fallback when no build-time pin is shipped (same
 * circuit + SRS ⇒ same vk).
 */
import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

const WITNESS_KEY_PREFIX = 'passport.show-witness.v1:';
const VK_SELF_PIN_KEY = 'passport.show-vk-self-pin.v1';

/**
 * Build-time pin for the trusted `openac_show` vk (sha256 hex, lowercase).
 * Filled from the passport-noir release pipeline once the artifact hash is
 * published; until then the verifier relies on the enrollment self-pin and
 * fails closed when neither exists.
 */
export const PASSPORT_SHOW_VK_BUILD_PIN_SHA256: string | null = null;

export async function savePassportShowWitness(
  credentialId: string,
  witnessBundleJson: string
): Promise<void> {
  const blob = await encryptJson({ witnessBundleJson });
  getMmkv().set(witnessKey(credentialId), blob);
}

export async function loadPassportShowWitness(
  credentialId: string
): Promise<string | null> {
  const blob = getMmkv().getString(witnessKey(credentialId));
  if (blob === undefined) return null;
  try {
    const parsed = await decryptJson<{ witnessBundleJson?: unknown }>(blob);
    const json = parsed.witnessBundleJson;
    return typeof json === 'string' && json.length > 0 ? json : null;
  } catch {
    return null;
  }
}

export function hasPassportShowWitness(credentialId: string): boolean {
  return getMmkv().contains(witnessKey(credentialId));
}

/** Render-path variant: false instead of throwing when MMKV isn't up yet. */
export function hasPassportShowWitnessSafe(credentialId: string): boolean {
  try {
    return hasPassportShowWitness(credentialId);
  } catch {
    return false;
  }
}

export function deletePassportShowWitness(credentialId: string): void {
  getMmkv().remove(witnessKey(credentialId));
}

export function savePassportShowVkSelfPin(sha256Hex: string): void {
  getMmkv().set(VK_SELF_PIN_KEY, sha256Hex.toLowerCase());
}

export function loadPassportShowVkSelfPin(): string | null {
  return getMmkv().getString(VK_SELF_PIN_KEY) ?? null;
}

export function resolvePassportShowVkPins(): {
  readonly buildPin: string | null;
  readonly selfPin: string | null;
} {
  return {
    buildPin: PASSPORT_SHOW_VK_BUILD_PIN_SHA256,
    selfPin: safeLoadSelfPin(),
  };
}

function safeLoadSelfPin(): string | null {
  try {
    return loadPassportShowVkSelfPin();
  } catch {
    // MMKV not initialised yet (cold scan before boot finished) — the
    // verifier fails closed on missing pins rather than crashing the scan.
    return null;
  }
}

function witnessKey(credentialId: string): string {
  return `${WITNESS_KEY_PREFIX}${credentialId}`;
}
