import { describe, expect, it } from 'bun:test';

import {
  clearPassportShowPrefetch,
  consumePrefetchedPassportShowWitness,
  prefetchPassportShowPresentation,
} from '../../src/passport/showPrefetch';

describe('passport show prefetch', () => {
  it('starts one witness load per credential and exposes the promise', async () => {
    clearPassportShowPrefetch();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return 'witness-json';
    };
    let modules = 0;
    prefetchPassportShowPresentation('cred-1', loader, () => {
      modules += 1;
    });
    prefetchPassportShowPresentation('cred-1', loader, () => {
      modules += 1;
    });
    expect(loads).toBe(1);
    expect(modules).toBe(2);
    await expect(consumePrefetchedPassportShowWitness('cred-1')).resolves.toBe('witness-json');
  });

  it('caches a failed load as null (prove path falls back to its own load)', async () => {
    clearPassportShowPrefetch();
    prefetchPassportShowPresentation(
      'cred-2',
      async () => {
        throw new Error('mmkv not ready');
      },
      () => {}
    );
    await expect(consumePrefetchedPassportShowWitness('cred-2')).resolves.toBeNull();
  });

  it('clear removes one credential or everything', async () => {
    clearPassportShowPrefetch();
    prefetchPassportShowPresentation('a', async () => 'wa', () => {});
    prefetchPassportShowPresentation('b', async () => 'wb', () => {});
    clearPassportShowPrefetch('a');
    expect(consumePrefetchedPassportShowWitness('a')).toBeNull();
    await expect(consumePrefetchedPassportShowWitness('b')).resolves.toBe('wb');
    clearPassportShowPrefetch();
    expect(consumePrefetchedPassportShowWitness('b')).toBeNull();
  });

  it('swallows module loader failures (prove path surfaces the real error)', () => {
    clearPassportShowPrefetch();
    expect(() => {
      prefetchPassportShowPresentation('cred-3', async () => 'w', () => {
        throw new Error('nitro unavailable');
      });
    }).not.toThrow();
  });
});
