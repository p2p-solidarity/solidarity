import { normalizeEnsHandle, type HandleResolutionResult } from '../handles';
import type { ProfileRecord } from '../profile';

import { verifyResolvedHandleBinding, type VerifyHandleBindingResult } from './handleBinding';

export type VerifyEnsBindingResult = VerifyHandleBindingResult;

/** Pure gate over a fetched, JWS-verified profile and its fresh ENS lookup. */
export function verifyEnsBinding(
  profile: ProfileRecord,
  handle: string,
  resolution: HandleResolutionResult
): VerifyEnsBindingResult {
  return verifyResolvedHandleBinding(profile, 'ens', normalizeEnsHandle(handle), resolution);
}
