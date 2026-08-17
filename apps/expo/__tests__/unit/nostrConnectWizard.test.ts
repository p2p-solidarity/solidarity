/**
 * The advanced Nostr route keeps import available, while the normal path is
 * one user action: provision if needed, then publish without a method or
 * relay-confirmation screen.
 */
import { describe, expect, it } from 'bun:test';

import type { TFunction } from 'i18next';

import {
  formatNostrRelayRejection,
  initialNostrConnectWizardState,
  isBiometricCancellation,
  isNostrPublishOutcomePartiallyAccepted,
  isNostrPublishOutcomeSuccessful,
  nostrConnectWizardReducer,
  prepareNostrClaimForSave,
  publishWithNostrAutoSetup,
  relayRejections,
  type NostrConnectWizardAction,
  type NostrConnectWizardState,
} from '@/nostr/connectWizard';

/**
 * Stand-in for i18next that reproduces the real en.json entries for the
 * publish-outcome namespace, so the formatter test pins the ACTUAL rendered
 * line rather than a placeholder. Keep in sync with
 * `src/i18n/locales/en.json` `publishOutcome.*`.
 */
const EN_PUBLISH_OUTCOME: Record<string, string> = {
  'publishOutcome.copy.page': 'page',
  'publishOutcome.copy.verification': 'verification',
  'publishOutcome.noResponse': 'no response',
};

const t = ((key: string, vars?: Record<string, unknown>): string => {
  if (key === 'publishOutcome.relayRejectionLine') {
    return `${String(vars?.['copy'])} ${String(vars?.['relay'])}: ${String(vars?.['message'])} (${String(vars?.['ms'])}ms)`;
  }
  return EN_PUBLISH_OUTCOME[key] ?? key;
}) as unknown as TFunction;

const SUCCESSFUL_OUTCOME = {
  profile: {
    event: { id: 'e1', pubkey: 'p', created_at: 1, kind: 30078, tags: [], content: '', sig: 's' },
    results: [
      { relay: 'wss://a.example', accepted: true, message: 'ok', elapsedMs: 1 },
      { relay: 'wss://b.example', accepted: true, message: 'ok', elapsedMs: 1 },
    ],
    acceptedCount: 2,
    requiredCount: 2,
    success: true,
  },
  kind0: {
    event: { id: 'e2', pubkey: 'p', created_at: 1, kind: 0, tags: [], content: '{}', sig: 's' },
    results: [
      { relay: 'wss://a.example', accepted: true, message: 'ok', elapsedMs: 1 },
      { relay: 'wss://b.example', accepted: true, message: 'ok', elapsedMs: 1 },
    ],
    acceptedCount: 2,
    requiredCount: 2,
    success: true,
  },
} as const;

function dispatch(
  state: NostrConnectWizardState,
  ...actions: readonly NostrConnectWizardAction[]
): NostrConnectWizardState {
  return actions.reduce(nostrConnectWizardReducer, state);
}

describe('initialNostrConnectWizardState', () => {
  it('starts on the single default publish action with advanced import collapsed', () => {
    expect(initialNostrConnectWizardState()).toEqual({
      status: 'idle',
      step: 'ready',
      method: null,
      nsecInput: '',
      outcome: null,
      errorMessage: null,
      errorStage: null,
    });
  });
});

describe('default publish flow', () => {
  it('provisions when needed, then publishes automatically', () => {
    const provisioning = dispatch(initialNostrConnectWizardState(), {
      type: 'startProvisioning',
    });
    expect(provisioning.status).toBe('provisioning');
    expect(provisioning.method).toBe('mnemonic');

    const publishing = dispatch(provisioning, { type: 'provisioningSucceeded' });
    expect(publishing.status).toBe('publishing');

    const published = dispatch(publishing, {
      type: 'publishingSucceeded',
      outcome: SUCCESSFUL_OUTCOME,
    });
    expect(published.status).toBe('published');
    expect(published.outcome).toEqual(SUCCESSFUL_OUTCOME);
  });

  it('publishes immediately when a key already exists', () => {
    const publishing = dispatch(initialNostrConnectWizardState(), { type: 'startPublishing' });
    expect(publishing.status).toBe('publishing');
  });
});

describe('advanced key import', () => {
  it('is disclosed explicitly and publishes automatically after import', () => {
    const importStep = dispatch(initialNostrConnectWizardState(), { type: 'showNsecImport' });
    expect(importStep.step).toBe('pasteNsec');

    const typed = dispatch(importStep, { type: 'setNsecInput', value: 'nsec1existing' });
    const provisioning = dispatch(typed, { type: 'submitNsec' });
    expect(provisioning.status).toBe('provisioning');
    expect(provisioning.method).toBe('nsec');

    const publishing = dispatch(provisioning, { type: 'provisioningSucceeded' });
    expect(publishing.status).toBe('publishing');
  });

  it('does not submit a blank import and can collapse without keeping secret input', () => {
    const importStep = dispatch(initialNostrConnectWizardState(), { type: 'showNsecImport' });
    const blank = dispatch(importStep, { type: 'setNsecInput', value: '   ' });
    expect(dispatch(blank, { type: 'submitNsec' })).toEqual(blank);

    const typed = dispatch(importStep, { type: 'setNsecInput', value: 'nsec1partial' });
    const hidden = dispatch(typed, { type: 'hideNsecImport' });
    expect(hidden.step).toBe('ready');
    expect(hidden.nsecInput).toBe('');
  });
});

describe('honest completion and recovery', () => {
  it('sub-quorum with ≥1 relay holding each copy lands on the outcome step, not error (S8f)', () => {
    const publishing = dispatch(initialNostrConnectWizardState(), { type: 'startPublishing' });
    const partialOutcome = {
      ...SUCCESSFUL_OUTCOME,
      kind0: {
        ...SUCCESSFUL_OUTCOME.kind0,
        results: [
          { relay: 'wss://a.example', accepted: true, message: 'ok', elapsedMs: 1 },
          { relay: 'wss://b.example', accepted: false, message: 'timeout after 8000ms', elapsedMs: 8000 },
        ],
        acceptedCount: 1,
        success: false,
      },
    };
    const partial = dispatch(publishing, {
      type: 'publishingSucceeded',
      outcome: partialOutcome,
    });
    expect(partial.status).toBe('published');
    expect(partial.outcome).toEqual(partialOutcome);
    expect(partial.errorMessage).toBeNull();
  });

  it('zero acceptances on either copy is still an error, never published', () => {
    const publishing = dispatch(initialNostrConnectWizardState(), { type: 'startPublishing' });
    const deadOutcome = {
      ...SUCCESSFUL_OUTCOME,
      kind0: {
        ...SUCCESSFUL_OUTCOME.kind0,
        results: [
          { relay: 'wss://a.example', accepted: false, message: 'timeout after 8000ms', elapsedMs: 8000 },
          { relay: 'wss://b.example', accepted: false, message: 'websocket error', elapsedMs: 1 },
        ],
        acceptedCount: 0,
        success: false,
      },
    };
    const failed = dispatch(publishing, {
      type: 'publishingSucceeded',
      outcome: deadOutcome,
    });
    expect(failed.status).toBe('error');
    expect(failed.errorStage).toBe('publishing');
    expect(failed.outcome).toEqual(deadOutcome);
  });

  it('retries publishing without repeating provisioning or import', () => {
    const publishing = dispatch(initialNostrConnectWizardState(), { type: 'startPublishing' });
    const failed = dispatch(publishing, {
      type: 'publishingFailed',
      message: 'network unavailable',
    });
    const retried = dispatch(failed, { type: 'retry' });
    expect(retried.status).toBe('idle');
    expect(retried.step).toBe('ready');
    expect(retried.errorMessage).toBeNull();
  });

  it('returns silently to the editor after biometric cancellation', () => {
    const provisioning = dispatch(initialNostrConnectWizardState(), {
      type: 'startProvisioning',
    });
    const cancelled = dispatch(provisioning, { type: 'provisioningCancelled' });
    expect(cancelled.status).toBe('idle');
    expect(cancelled.step).toBe('ready');
    expect(cancelled.errorMessage).toBeNull();
  });
});

describe('publish outcome and cancellation helpers', () => {
  it('requires both publish reports to pass their existing quorum rules', () => {
    expect(isNostrPublishOutcomeSuccessful(SUCCESSFUL_OUTCOME)).toBe(true);
    expect(
      isNostrPublishOutcomeSuccessful({
        ...SUCCESSFUL_OUTCOME,
        profile: { ...SUCCESSFUL_OUTCOME.profile, success: false },
      })
    ).toBe(false);
    expect(
      isNostrPublishOutcomeSuccessful({
        ...SUCCESSFUL_OUTCOME,
        kind0: { ...SUCCESSFUL_OUTCOME.kind0, success: false },
      })
    ).toBe(false);
  });

  it('recognizes both tagged provisioning cancellation and the save-flow message', () => {
    expect(isBiometricCancellation('biometricDenied')).toBe(true);
    expect(
      isBiometricCancellation('profile save failed: biometric authentication was denied')
    ).toBe(true);
    expect(
      isBiometricCancellation(
        'profile save failed: signing was denied or failed (biometric authentication required)'
      )
    ).toBe(true);
    expect(isBiometricCancellation('network unavailable')).toBe(false);
  });

  it('partial acceptance needs ≥1 accepted relay on EACH copy — a page with no verification copy is not partial', () => {
    expect(isNostrPublishOutcomePartiallyAccepted(SUCCESSFUL_OUTCOME)).toBe(true);
    expect(
      isNostrPublishOutcomePartiallyAccepted({
        ...SUCCESSFUL_OUTCOME,
        kind0: { ...SUCCESSFUL_OUTCOME.kind0, acceptedCount: 1, success: false },
      })
    ).toBe(true);
    expect(
      isNostrPublishOutcomePartiallyAccepted({
        ...SUCCESSFUL_OUTCOME,
        kind0: { ...SUCCESSFUL_OUTCOME.kind0, acceptedCount: 0, success: false },
      })
    ).toBe(false);
    expect(
      isNostrPublishOutcomePartiallyAccepted({
        ...SUCCESSFUL_OUTCOME,
        profile: { ...SUCCESSFUL_OUTCOME.profile, acceptedCount: 0, success: false },
      })
    ).toBe(false);
  });

  it('carries each rejected relay message into the failure trace, and nothing on full success', () => {
    expect(relayRejections(SUCCESSFUL_OUTCOME)).toEqual([]);

    const partial = {
      profile: {
        ...SUCCESSFUL_OUTCOME.profile,
        results: [
          { relay: 'wss://a.example', accepted: true, message: 'ok', elapsedMs: 40 },
          { relay: 'wss://b.example', accepted: false, message: 'rate-limited: slow down', elapsedMs: 90.4 },
        ],
        acceptedCount: 1,
        success: false,
      },
      kind0: {
        ...SUCCESSFUL_OUTCOME.kind0,
        results: [
          { relay: 'wss://a.example', accepted: false, message: '', elapsedMs: 8000 },
          { relay: 'wss://b.example', accepted: true, message: 'ok', elapsedMs: 55 },
        ],
        acceptedCount: 1,
        success: false,
      },
    };
    // The structured reading carries the relay's own evidence plus an i18n
    // KEY for which copy failed — no baked English in the state machine.
    expect(relayRejections(partial)).toEqual([
      {
        copyKey: 'publishOutcome.copy.page',
        relay: 'wss://b.example',
        message: 'rate-limited: slow down',
        elapsedMs: 90.4,
      },
      {
        // A relay that never answered carries `null`, so the formatter — not
        // the state machine — decides how "no response" reads per locale.
        copyKey: 'publishOutcome.copy.verification',
        relay: 'wss://a.example',
        message: null,
        elapsedMs: 8000,
      },
    ]);

    // …and rendering through the real en.json shapes reproduces exactly the
    // lines the hardcoded formatter used to emit (no user-visible drift).
    expect(relayRejections(partial).map((r) => formatNostrRelayRejection(r, t))).toEqual([
      'page wss://b.example: rate-limited: slow down (90ms)',
      'verification wss://a.example: no response (8000ms)',
    ]);
  });
});

describe('prepareNostrClaimForSave', () => {
  it('provisions a missing key and returns its npub claim before the profile is signed', async () => {
    const calls: string[] = [];
    const result = await prepareNostrClaimForSave(['at://alice.test'], {
      hasKey: async () => {
        calls.push('hasKey');
        return false;
      },
      provision: async () => {
        calls.push('provision');
        return { ok: true, value: 'fresh-pubkey' };
      },
      getPubkey: async () => {
        calls.push('getPubkey');
        return { ok: false, error: 'should not read after provisioning' };
      },
      encodeNpub: (pubkey) => {
        calls.push(`encode:${pubkey}`);
        return { ok: true, value: 'npub1fresh' };
      },
    });

    expect(result).toEqual({
      ok: true,
      value: ['at://alice.test', 'nostr:npub1fresh'],
    });
    expect(calls).toEqual(['hasKey', 'provision', 'encode:fresh-pubkey']);
  });

  it('reads an existing key without provisioning and does not duplicate its claim', async () => {
    let provisionCalls = 0;
    const result = await prepareNostrClaimForSave(
      ['nostr:npub1existing', 'at://alice.test'],
      {
        hasKey: async () => true,
        provision: async () => {
          provisionCalls += 1;
          return { ok: true, value: 'unused' };
        },
        getPubkey: async () => ({ ok: true, value: 'existing-pubkey' }),
        encodeNpub: () => ({ ok: true, value: 'npub1existing' }),
      }
    );

    expect(result).toEqual({
      ok: true,
      value: ['nostr:npub1existing', 'at://alice.test'],
    });
    expect(provisionCalls).toBe(0);
  });

  it('returns a tagged failure without fabricating a claim when setup fails', async () => {
    const result = await prepareNostrClaimForSave([], {
      hasKey: async () => false,
      provision: async () => ({ ok: false, error: 'biometricDenied' }),
      getPubkey: async () => ({ ok: false, error: 'notProvisioned' }),
      encodeNpub: () => ({ ok: false, error: 'must not encode' }),
    });

    expect(result).toEqual({ ok: false, error: 'biometricDenied' });
  });
});

describe('publishWithNostrAutoSetup', () => {
  it('provisions only when the user-triggered publish finds no device key', async () => {
    const calls: string[] = [];
    const result = await publishWithNostrAutoSetup({
      hasKey: async () => false,
      provision: async () => {
        calls.push('provision');
        return { ok: true, value: 'pubkey' };
      },
      publish: async () => {
        calls.push('publish');
        return { ok: true, value: SUCCESSFUL_OUTCOME };
      },
    });
    expect(result).toEqual({ ok: true, value: SUCCESSFUL_OUTCOME });
    expect(calls).toEqual(['provision', 'publish']);
  });

  it('uses an existing key without provisioning and stops on provisioning failure', async () => {
    let provisionCalls = 0;
    let publishCalls = 0;
    const existing = await publishWithNostrAutoSetup({
      hasKey: async () => true,
      provision: async () => {
        provisionCalls += 1;
        return { ok: true, value: 'unused' };
      },
      publish: async () => {
        publishCalls += 1;
        return { ok: true, value: SUCCESSFUL_OUTCOME };
      },
    });
    expect(existing.ok).toBe(true);
    expect(provisionCalls).toBe(0);
    expect(publishCalls).toBe(1);

    const failed = await publishWithNostrAutoSetup({
      hasKey: async () => false,
      provision: async () => ({ ok: false, error: 'biometricDenied' }),
      publish: async () => {
        publishCalls += 1;
        return { ok: true, value: SUCCESSFUL_OUTCOME };
      },
    });
    expect(failed).toEqual({ ok: false, error: 'biometricDenied' });
    expect(publishCalls).toBe(1);
  });
});
