/**
 * `zoomFadeIn` returns the entering animation Reanimated runs on the UI
 * runtime for the Me sheets (ProfileShareSurface / PublishPreviewSheet). If the
 * worklets babel plugin stops workletizing it, release builds terminate the
 * moment a sheet opens ("[Worklets] Tried to synchronously call a non-worklet
 * function"). Same artifact-level guard as pageRowStylesWorklet.test.ts: bun
 * never runs the UI runtime, so assert the babel output stamps `__workletHash`.
 */
import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

import { transformFileSync } from '@babel/core';

function transform(relativePath: string): string {
  const out = transformFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), {
    babelrc: false,
    configFile: false,
    presets: ['@babel/preset-typescript'],
    plugins: ['react-native-worklets/plugin'],
  });
  return out?.code ?? '';
}

describe('motion worklet contract', () => {
  it('workletizes the zoomFadeIn entering animation for the UI runtime', () => {
    expect(transform('../../src/feedback/motion.ts')).toMatch(
      /zoomFadeInEntering\.__workletHash\s*=/u,
    );
  });
});
