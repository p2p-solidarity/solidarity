/**
 * bun test preload — runs once before any test file.
 *
 * Globals like `expect.each` / `it.each` are bun built-ins (since bun 1.2).
 * Native modules that touch JSI (mmkv, secure-store, vision-camera, nitro)
 * are stubbed lazily — only the suites that import them install a mock,
 * which keeps the parity tests (pure TS over fixtures) fast + isolated.
 */
export {};
