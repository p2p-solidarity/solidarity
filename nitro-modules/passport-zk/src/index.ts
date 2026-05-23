/**
 * @solidarity/nitro-passport-zk — public entrypoint.
 *
 * Until `bunx nitrogen generate` runs and produces
 * `nitrogen/generated/<HybridPassportZk>` bindings, this barrel only
 * re-exports the spec type so app code can `import type` without
 * pulling native bridges into Metro's resolver.
 */
export type {
  PassportZk,
  NoirProofResult,
} from './specs/PassportZk.nitro';

// After codegen + native impl ship:
//   import { NitroModules } from 'react-native-nitro-modules';
//   import type { PassportZk } from './specs/PassportZk.nitro';
//   export const passportZk = NitroModules.createHybridObject<PassportZk>('PassportZk');
