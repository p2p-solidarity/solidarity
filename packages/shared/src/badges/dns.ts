import { normalizeDnsHandle, type HandleResolutionResult } from '../handles';
import type { ProfileRecord } from '../profile';

import { verifyResolvedHandleBinding, type VerifyHandleBindingResult } from './handleBinding';

export type VerifyDnsBindingResult = VerifyHandleBindingResult;

/** Pure gate over a fetched, JWS-verified profile and its fresh DNS lookup. */
export function verifyDnsBinding(
  profile: ProfileRecord,
  handle: string,
  resolution: HandleResolutionResult
): VerifyDnsBindingResult {
  return verifyResolvedHandleBinding(profile, 'dns', normalizeDnsHandle(handle), resolution);
}
