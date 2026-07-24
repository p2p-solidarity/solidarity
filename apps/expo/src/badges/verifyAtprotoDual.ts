/**
 * Transitional dual-compare for the ATProto binding (mirrors the jwt.ts
 * dual-verify precedent, A10.4): the PDS may hold either the signed PUBLIC
 * projection (written by `connectAtproto` since the public-projection
 * upload) or the FULL source-of-truth record (written by older connects).
 * `verifyAtprotoBinding` exact-compares the fetched PDS record against the
 * supplied one, so verifying with only one shape yields false "declared"
 * results for profiles published under the other. Try the public projection
 * first; only on a non-verified outcome retry with the full record. The
 * public-projection result stays authoritative for evidence when both fail.
 */
import {
  verifyAtprotoBinding,
  type ProfileRecord,
  type VerifyAtprotoBindingResult,
} from '@solidarity/shared';

type VerifyFn = typeof verifyAtprotoBinding;
type BindingIO = Parameters<VerifyFn>[1];

export async function verifyAtprotoBindingDual(
  fullRecord: ProfileRecord,
  publicRecord: ProfileRecord | null,
  io: BindingIO,
  verify: VerifyFn = verifyAtprotoBinding
): Promise<VerifyAtprotoBindingResult> {
  const primary = publicRecord ?? fullRecord;
  const first = await verify(primary, io);
  if (first.state === 'verified') return first;
  if (publicRecord === null || publicRecord === fullRecord) return first;
  const second = await verify(fullRecord, io);
  return second.state === 'verified' ? second : first;
}
