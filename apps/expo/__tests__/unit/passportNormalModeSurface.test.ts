import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';
import { PASSPORT_STEP_META } from '../../src/passport/pipeline';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('normal-mode privacy and passport surfaces', () => {
  it('uses the global five-tap Developer Mode as the only privacy diagnostics unlock', () => {
    const disclosure = source('../../app/settings/disclosure.tsx');

    expect(disclosure).toContain(
      'const developerMode = usePreferences((state) => state.developerMode);'
    );
    expect(disclosure).not.toContain('const [showDevToggle');
    expect(disclosure).not.toContain('const [tapCount');
    expect(disclosure).not.toContain('const onZkTap');
    expect(disclosure).toContain('{developerMode ? (');

    const normalCopy = [
      en['disclosure.title'],
      zhHant['disclosure.title'],
    ].join(' ');
    expect(normalCopy).not.toMatch(/selective disclosure|zero-knowledge|\bZK\b|選擇性揭露|零知識/iu);
  });

  it('keeps product-facing passport step metadata free of protocol terms', () => {
    const stepCopyKeys = Object.values(PASSPORT_STEP_META)
      .flatMap((meta) => [meta.title, meta.subtitle])
      .map((key) => key as keyof typeof en);
    const visibleStepCopy: string[] = [];

    for (const key of stepCopyKeys) {
      const english = en[key];
      const traditionalChinese = zhHant[key as keyof typeof zhHant];
      expect(english).toBeTruthy();
      expect(traditionalChinese).toBeTruthy();
      visibleStepCopy.push(english, traditionalChinese);
    }

    expect(visibleStepCopy.join(' ')).not.toMatch(
      /\b(?:MRZ|NFC|ZK|SD-JWT|OpenAC|BAC|PACE|PA|SOD|L1|L3)\b|\bDG\d+\b|credential|persist/iu
    );
  });

  it('passes Developer Mode into each passport step and renders product-safe normal states', () => {
    const passport = source('../../app/passport/index.tsx');
    const steps = source('../../src/components/passport/PassportSteps.tsx');
    const details = source('../../src/components/passport/PassportMrzStep.tsx');

    for (const component of ['PassportMrzStep', 'NfcStep', 'ProofStep', 'PersistStep']) {
      expect(passport).toMatch(
        new RegExp(`<${component}[\\s\\S]*?developerMode=\\{developerMode\\}`, 'u')
      );
    }

    expect(passport).toMatch(
      /statusText=\{[\s\S]*?developerMode\s*\?\s*state\.proofProgressMessage/u
    );
    expect(steps).toContain('readonly developerMode: boolean;');
    expect(steps).toContain('if (!developerMode) {');
    expect(steps).toContain("t('passportSetup.proof.ready')");
    expect(steps).toContain("t('passportSetup.proof.unavailable')");
    expect(steps).toContain("t('passportSetup.persist.fallback')");
    expect(steps).toContain("t('passportSetup.nfc.reading')");
    expect(passport).toContain("proof.generationFailed ? t('passportSetup.savedUnverified')");
    expect(details).toContain('readonly developerMode: boolean;');
    expect(details).toContain("t('passportSetup.details.scanHint')");
    expect(details).toContain("t('passportSetup.details.continue')");
  });

  it('keeps technical passport error reports exclusive to Developer Mode', () => {
    const passport = source('../../app/passport/index.tsx');

    expect(passport).toContain("import { appAlert, showError } from '@/feedback/appAlert';");
    expect(passport).toContain('readonly developerMode: boolean;');
    expect(passport).toContain('if (!args.developerMode) {');
    expect(passport).toContain('appAlert({');
    expect(passport).toContain('error: buildPassportErrorDetail({');
  });

  it('localizes the normal passport status and recovery copy in both supported languages', () => {
    const keys = [
      'passportSetup.nfc.reading',
      'passportSetup.proof.ready',
      'passportSetup.error.nfcUnavailable',
      'passportSetup.error.privateCheck',
      'passportSetup.error.save',
    ] as const;

    for (const key of keys) {
      expect(en[key]).toBeTruthy();
      expect(zhHant[key]).toBeTruthy();
    }
  });

  it('keeps the passport camera and proof overlay calm in normal mode while retaining diagnostics for Developer Mode', () => {
    const passport = source('../../app/passport/index.tsx');
    const camera = source('../../src/onboarding/steps/MRZCameraStep.tsx');
    const proofOverlay = source('../../src/components/common/CryptoCompilingOverlay.tsx');

    expect(passport).toMatch(
      /<MRZCameraStep[\s\S]*?developerMode=\{developerMode\}/u
    );
    expect(passport).toMatch(
      /<CryptoCompilingOverlay[\s\S]*?developerMode=\{developerMode\}/u
    );
    expect(camera).toContain('readonly developerMode?: boolean;');
    expect(camera).toContain('developerMode = false');
    expect(camera).toContain("primary: 'passportSetup.camera.align'");
    expect(camera).toContain("t('passportSetup.camera.manualA11y')");
    expect(camera).toContain("t('passportSetup.camera.confirmed')");
    expect(camera).toContain('DEVELOPER_PHASE_COPY');
    expect(camera).toContain("primary: 'Align passport MRZ here'");
    expect(proofOverlay).toContain('readonly developerMode?: boolean;');
    expect(proofOverlay).toContain('developerMode = false');
    expect(proofOverlay).toContain('if (!visible || !developerMode || stage !== \'proving\') return;');
    expect(proofOverlay).toContain('{developerMode ? (');
    expect(passport).toContain("import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';");
    expect(passport).toContain('const onProofOverlayDone = useCallback(');
    expect(passport).toContain('onDone={onProofOverlayDone}');
    expect(passport).not.toContain('onDone={() => {');

    const normalCameraKeys = [
      'passportSetup.camera.align',
      'passportSetup.camera.reading',
      'passportSetup.camera.unclear',
      'passportSetup.camera.confirmed',
      'passportSetup.camera.manualA11y',
      'passportSetup.camera.footer',
    ] as const;
    const normalCameraCopy = normalCameraKeys.flatMap((key) => [en[key], zhHant[key]]).join(' ');
    expect(normalCameraCopy).not.toMatch(/\bMRZ\b|機器可讀區/iu);
  });
});
