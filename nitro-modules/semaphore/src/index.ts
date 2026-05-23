/**
 * @solidarity/nitro-semaphore — public entrypoint.
 *
 * Lazily creates the singleton HybridObject so importing the package
 * doesn't crash on platforms where the native module isn't linked yet
 * (Expo Go, web preview, jest/bun without the JSI bridge).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { Semaphore } from './specs/Semaphore.nitro';

export type {
  Semaphore,
  SemaphoreProof,
} from './specs/Semaphore.nitro';

let cached: Semaphore | null = null;

export function getSemaphore(): Semaphore {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<Semaphore>('Semaphore');
  return cached;
}
