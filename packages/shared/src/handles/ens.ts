import { keccak_256 } from '@noble/hashes/sha3.js';

import { bytesToUtf8, utf8ToBytes } from '../crypto/base64';
import { bytesToHex, hexToBytes } from '../crypto/hex';
import { err, ok, type Result } from '../types/result';

import { DID_POINTER_MAX_BYTES, parseDidPointer, type DidPointer } from './didPointer';
import type {
  HandleResolutionError,
  HandleResolutionResult,
  HandleResolver,
  ResolverIO,
} from './types';

export const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

const ENS_PREFIX = 'ens:';
const ENS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ENS_MAX_LENGTH = 253;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PRIMARY_TEXT_KEY = 'org.solidarity.did';
const LEGACY_TEXT_KEY = 'did';
const ABI_HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/u;

export function normalizeEnsHandle(handle: string): string {
  const normalized = handle.trim().toLowerCase();
  return normalized.startsWith(ENS_PREFIX) ? normalized.slice(ENS_PREFIX.length) : normalized;
}

export function isValidEnsHandle(handle: string): boolean {
  const normalized = normalizeEnsHandle(handle);
  if (normalized.length === 0 || normalized.length > ENS_MAX_LENGTH) return false;
  const labels = normalized.split('.');
  return (
    labels.length >= 2 &&
    labels[labels.length - 1] === 'eth' &&
    labels.every((label) => ENS_LABEL_RE.test(label))
  );
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const value = new Uint8Array(left.length + right.length);
  value.set(left);
  value.set(right, left.length);
  return value;
}

/** ENSIP-1 namehash for the ASCII-normalized names accepted by this v1 resolver. */
export function ensNamehash(name: string): Result<string, 'invalidHandle'> {
  if (!isValidEnsHandle(name)) return err('invalidHandle');
  const normalized = normalizeEnsHandle(name);

  let node = new Uint8Array(32);
  const labels = normalized.split('.');
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index];
    if (label === undefined) return err('invalidHandle');
    node = keccak_256(concat(node, keccak_256(utf8ToBytes(label))));
  }
  return ok(`0x${bytesToHex(node)}`);
}

function selector(signature: string): string {
  return bytesToHex(keccak_256(utf8ToBytes(signature)).slice(0, 4));
}

function uint256Word(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function encodeResolverCall(node: string): string {
  return `0x${selector('resolver(bytes32)')}${node.slice(2)}`;
}

function encodeTextCall(node: string, key: string): string {
  const keyBytes = utf8ToBytes(key);
  const keyHex = bytesToHex(keyBytes);
  const paddedKeyHex = keyHex.padEnd(Math.ceil(keyHex.length / 64) * 64, '0');
  return `0x${selector('text(bytes32,string)')}${node.slice(2)}${uint256Word(64)}${uint256Word(keyBytes.length)}${paddedKeyHex}`;
}

function decodeAbiHex(value: string): Uint8Array | null {
  if (!ABI_HEX_RE.test(value)) return null;
  try {
    return hexToBytes(value);
  } catch {
    return null;
  }
}

function decodeAddress(value: string): string | null {
  const bytes = decodeAbiHex(value);
  if (bytes?.length !== 32) return null;
  if (!bytes.slice(0, 12).every((byte) => byte === 0)) return null;
  return `0x${bytesToHex(bytes.slice(12))}`;
}

function readWord(bytes: Uint8Array, offset: number): bigint | null {
  if (offset < 0 || offset + 32 > bytes.length) return null;
  let value = 0n;
  for (let index = offset; index < offset + 32; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) return null;
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function decodeText(value: string): string | null {
  try {
    const bytes = decodeAbiHex(value);
    if (bytes === null || bytes.length < 64) return null;
    const offsetWord = readWord(bytes, 0);
    if (offsetWord !== 32n) return null;
    const offset = Number(offsetWord);
    const lengthWord = readWord(bytes, offset);
    if (lengthWord === null || lengthWord > BigInt(DID_POINTER_MAX_BYTES)) return null;
    const length = Number(lengthWord);
    const start = offset + 32;
    const paddedEnd = start + Math.ceil(length / 32) * 32;
    if (bytes.length !== paddedEnd) return null;
    if (!bytes.slice(start + length, paddedEnd).every((byte) => byte === 0)) return null;
    return bytesToUtf8(bytes.slice(start, start + length));
  } catch {
    return null;
  }
}

async function readTextPointer(
  resolverAddress: string,
  node: string,
  key: string,
  io: ResolverIO
): Promise<Result<DidPointer | null, HandleResolutionError>> {
  const call = await io.ethCall?.(resolverAddress, encodeTextCall(node, key));
  if (call === undefined) return err('unreachable');
  if (!call.ok) return call.error === 'notFound' ? ok(null) : err(call.error);
  const decoded = decodeText(call.value);
  if (decoded === null) return err('unreachable');
  if (decoded.length === 0) return ok(null);
  return parseDidPointer(decoded);
}

export class EnsHandleResolver implements HandleResolver {
  readonly scheme = 'ens' as const;

  matches(handle: string): boolean {
    return isValidEnsHandle(handle);
  }

  async resolve(handle: string, io: ResolverIO): Promise<HandleResolutionResult> {
    const node = ensNamehash(handle);
    if (!node.ok) return node;
    if (io.ethCall === undefined) return err('unreachable');

    try {
      const resolverCall = await io.ethCall(ENS_REGISTRY_ADDRESS, encodeResolverCall(node.value));
      if (!resolverCall.ok) return err(resolverCall.error);
      const resolverAddress = decodeAddress(resolverCall.value);
      if (resolverAddress === null) return err('unreachable');
      // ENSIP-10 wildcard/CCIP-read resolution is deliberately outside v1:
      // a registry miss is authoritative for this direct onchain resolver.
      if (resolverAddress === ZERO_ADDRESS) return err('notFound');

      const primary = await readTextPointer(resolverAddress, node.value, PRIMARY_TEXT_KEY, io);
      if (!primary.ok) return primary;
      if (primary.value !== null) {
        return ok({ did: primary.value.did, sources: primary.value.sources });
      }

      const legacy = await readTextPointer(resolverAddress, node.value, LEGACY_TEXT_KEY, io);
      if (!legacy.ok) return legacy;
      return legacy.value === null
        ? err('notFound')
        : ok({ did: legacy.value.did, sources: legacy.value.sources });
    } catch {
      return err('unreachable');
    }
  }
}
