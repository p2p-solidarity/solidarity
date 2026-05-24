/**
 * PassportAnchorCommitmentStore — TS port of
 * solidarity/Services/ZK/PassportAnchorCommitmentStore.swift.
 *
 * Holds the per-install random "passport anchor" commitments used by the
 * Semaphore fallback bootstrap group when the holder has not joined any
 * peer group yet. Per Swift's design notes: sharing a hard-coded literal
 * across installs would let a passive observer recognise the
 * fallback-vs-real-group state in any group's public commitment list, so
 * each device draws its own random field element below the BN254 modulus.
 *
 * Storage: encrypted MMKV under key prefix `passport-anchor:`. Swift uses
 * the iOS Keychain; on the Expo port the master MMKV instance is already
 * AES-GCM sealed via the secure-master-key chain (Secure Enclave / StrongBox),
 * which offers the same threat model.
 */
import { getMmkv } from '@/storage/mmkv';

const PREFIX = 'passport-anchor:';
const PRIMARY_KEY = `${PREFIX}primary`;

export interface PassportAnchorCommitment {
  readonly anchor: string;
  readonly committedAt: Date;
  readonly nullifierKey: string;
}

interface SerializedAnchor {
  readonly anchor: string;
  readonly committedAt: string;
  readonly nullifierKey: string;
}

function serialize(a: PassportAnchorCommitment): SerializedAnchor {
  return {
    anchor: a.anchor,
    committedAt: a.committedAt.toISOString(),
    nullifierKey: a.nullifierKey,
  };
}

function deserialize(raw: string): PassportAnchorCommitment | null {
  try {
    const parsed = JSON.parse(raw) as SerializedAnchor;
    return {
      anchor: parsed.anchor,
      committedAt: new Date(parsed.committedAt),
      nullifierKey: parsed.nullifierKey,
    };
  } catch {
    return null;
  }
}

function byteToDecimalString(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const total = (digits[i] ?? 0) * 256 + carry;
      digits[i] = total % 10;
      carry = (total / 10) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 10);
      carry = (carry / 10) | 0;
    }
  }
  while (digits.length > 1 && digits[digits.length - 1] === 0) digits.pop();
  digits.reverse();
  const out = digits.join('');
  return out.length === 0 ? '1' : out;
}

function generateRandomCommitmentString(): string {
  const bytes = new Uint8Array(31);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return byteToDecimalString(bytes);
}

export function addAnchor(anchor: PassportAnchorCommitment): void {
  getMmkv().set(`${PREFIX}${anchor.anchor}`, JSON.stringify(serialize(anchor)));
  getMmkv().set(PRIMARY_KEY, anchor.anchor);
}

export function listAnchors(): readonly PassportAnchorCommitment[] {
  const out: PassportAnchorCommitment[] = [];
  for (const k of getMmkv().getAllKeys()) {
    if (!k.startsWith(PREFIX) || k === PRIMARY_KEY) continue;
    const raw = getMmkv().getString(k);
    if (!raw) continue;
    const parsed = deserialize(raw);
    if (parsed) out.push(parsed);
  }
  return out.sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());
}

export function hasAnchor(anchor: string): boolean {
  return getMmkv().contains(`${PREFIX}${anchor}`);
}

export function clearAll(): void {
  for (const k of getMmkv().getAllKeys()) {
    if (k.startsWith(PREFIX)) getMmkv().remove(k);
  }
}

export function getPassportAnchorCommitment(): string {
  const primary = getMmkv().getString(PRIMARY_KEY);
  if (primary && hasAnchor(primary)) return primary;
  const fresh = generateRandomCommitmentString();
  addAnchor({
    anchor: fresh,
    committedAt: new Date(),
    nullifierKey: '',
  });
  return fresh;
}
