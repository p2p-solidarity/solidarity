import { shortDid } from '@/components/id/shortDid';
import { encodeFragment, isValidAtprotoHandle, type ProfileRecord } from '@solidarity/shared';

const PROFILE_PAGE_URL = 'https://solidarity.gg/#';

export interface ProfileIdentityLine {
  readonly kind: 'handle' | 'did';
  readonly label: string;
}

export function atprotoHandleClaim(record: ProfileRecord): string | null {
  const claim = record.alsoKnownAs.find((value) => value.startsWith('at://'));
  if (claim === undefined) return null;
  const rawHandle = claim.slice('at://'.length);
  if (!isValidAtprotoHandle(rawHandle)) return null;
  const normalized = rawHandle.trim().toLowerCase();
  return normalized.startsWith('@') ? normalized.slice(1) : normalized;
}

export function profileIdentityLine(record: ProfileRecord): ProfileIdentityLine {
  const handle = atprotoHandleClaim(record);
  return handle
    ? { kind: 'handle', label: `@${handle}` }
    : { kind: 'did', label: shortDid(record.did) };
}

export interface ProfileShareModel {
  readonly offlineUrl: string;
  readonly shortUrl: string | null;
  readonly oversize: boolean;
}

export function buildProfileShareModel(record: ProfileRecord, jws: string): ProfileShareModel {
  const fragment = encodeFragment(jws);
  const nostrClaim = record.alsoKnownAs.find((value) => value.startsWith('nostr:npub'));
  return {
    offlineUrl: `${PROFILE_PAGE_URL}${fragment.fragment}`,
    shortUrl: nostrClaim ? `${PROFILE_PAGE_URL}${nostrClaim}` : null,
    oversize: fragment.oversize,
  };
}

export function selectProfileShareUrl(model: ProfileShareModel, preferShort: boolean): string {
  return preferShort && model.shortUrl ? model.shortUrl : model.offlineUrl;
}
