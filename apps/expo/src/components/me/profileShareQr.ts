import type { ProfileShareModel, ProfileShareUrlCandidate } from './meProfileModel';

/** The self-contained QR has a conservative density budget. Other formats
 * have their own independently-sized payloads, so only this exact source is
 * withheld when its signed fragment exceeds the budget. */
export function profileShareQrIsOversize(
  candidate: ProfileShareUrlCandidate,
  model: Pick<ProfileShareModel, 'oversize'>,
): boolean {
  return candidate.kind === 'offline' && model.oversize;
}
