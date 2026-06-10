/**
 * @solidarity/nitro-passport-zk — public entrypoint.
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { PassportZk } from './specs/PassportZk.nitro';

export type {
  PassportZk,
  NitroNoirProof,
  OpenAcV3WitnessBuildResult,
} from './specs/PassportZk.nitro';

let cached: PassportZk | null = null;

export function getPassportZk(): PassportZk {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<PassportZk>('PassportZk');
  return cached;
}
