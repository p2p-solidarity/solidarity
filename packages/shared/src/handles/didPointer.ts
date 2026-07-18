import { npubToHex } from '../nostr/npub';
import { err, ok, type Result } from '../types/result';

import type { ProfileSource } from './types';

export const DID_POINTER_MAX_BYTES = 4_096;

const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+(?::[A-Za-z0-9._:%-]+)*$/u;

export interface DidPointer {
  readonly did: string;
  readonly sources: readonly ProfileSource[];
}

export type DidPointerError = 'malformedDid' | 'conflictingRecords';

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function parseSource(value: string): ProfileSource | null {
  if (!value.startsWith('nostr:')) return null;
  const npub = value.slice('nostr:'.length);
  return npubToHex(npub).ok ? { kind: 'nostr', npub } : null;
}

/** Parse the shared DNS/ENS read grammar. Writing remains intentionally out of scope. */
export function parseDidPointer(value: string): Result<DidPointer, 'malformedDid'> {
  const trimmed = value.trim();
  if (trimmed.length === 0 || utf8ByteLength(trimmed) > DID_POINTER_MAX_BYTES) {
    return err('malformedDid');
  }

  if (trimmed.startsWith('did:')) {
    return DID_RE.test(trimmed) ? ok({ did: trimmed, sources: [] }) : err('malformedDid');
  }

  let did: string | null = null;
  let source: ProfileSource | null = null;
  let sawSource = false;
  for (const rawParameter of trimmed.split(';')) {
    const parameter = rawParameter.trim();
    const separator = parameter.indexOf('=');
    if (separator <= 0) return err('malformedDid');
    const key = parameter.slice(0, separator).trim();
    const parameterValue = parameter.slice(separator + 1).trim();
    if (key === 'did') {
      if (did !== null || !DID_RE.test(parameterValue)) return err('malformedDid');
      did = parameterValue;
    } else if (key === 'src') {
      if (sawSource) return err('malformedDid');
      sawSource = true;
      source = parseSource(parameterValue);
      if (source === null) return err('malformedDid');
    } else {
      return err('malformedDid');
    }
  }

  if (did === null) return err('malformedDid');
  return ok({ did, sources: source === null ? [] : [source] });
}

function unwrapDnsJsonTxt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;

  const chunks = trimmed.match(/"(?:\\.|[^"\\])*"/gu);
  if (chunks?.join(' ') !== trimmed.replace(/\s+/gu, ' ')) return trimmed;
  try {
    return chunks.map((chunk) => JSON.parse(chunk) as string).join('');
  } catch {
    return trimmed;
  }
}

function samePointer(left: DidPointer, right: DidPointer): boolean {
  if (left.did !== right.did || left.sources.length !== right.sources.length) return false;
  return left.sources.every((source, index) => {
    const other = right.sources[index];
    return source.npub === other?.npub;
  });
}

/**
 * TXT RRsets may contain unrelated records. The first parseable pointer is
 * selected only after confirming every other parseable pointer agrees.
 */
export function parseDidPointerRecords(
  records: readonly string[]
): Result<DidPointer | null, DidPointerError> {
  if (records.length === 0) return ok(null);

  let selected: DidPointer | null = null;
  for (const record of records) {
    const parsed = parseDidPointer(unwrapDnsJsonTxt(record));
    if (!parsed.ok) continue;
    if (selected === null) {
      selected = parsed.value;
    } else if (!samePointer(selected, parsed.value)) {
      return err('conflictingRecords');
    }
  }
  return selected === null ? err('malformedDid') : ok(selected);
}
