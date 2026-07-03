/**
 * Connect-Nostr wizard state machine — 04-plan Phase A4 task A4.4.
 *
 * TS module under test: apps/expo/src/nostr/connectWizard.ts
 *
 * What this suite pins:
 *   1. The happy path for BOTH provisioning methods (mnemonic-derive /
 *      paste-nsec) reaches `confirmRelays` with `npub` set, then
 *      `confirmPublish` -> `publishing` -> `published` carries the full
 *      `NostrPublishOutcome` through untouched.
 *   2. `provisioningFailed` / `publishingFailed` land in `error` with the
 *      right `errorStage`, and `retry` routes back to the CORRECT idle
 *      sub-screen for each stage (chooseMethod/pasteNsec for a
 *      provisioning failure depending on which method was attempted;
 *      confirmRelays — preserving npub/relays — for a publishing failure).
 *   3. `provisioningCancelled` (Face-ID decline) returns silently to idle
 *      WITHOUT ever populating `errorMessage` — matches
 *      `identity-export.tsx`'s existing non-alarming treatment of
 *      `biometricDenied`.
 *   4. Actions that don't apply to the current `status`/`step` are no-ops
 *      (defensive against a stale closure firing late) — every guarded
 *      branch is exercised at least once.
 *   5. `initialNostrConnectWizardState` seeds exactly the caller-provided
 *      relay list (never `DEFAULT_RELAYS` implicitly — this module doesn't
 *      even import that constant).
 */
import { describe, expect, it } from 'bun:test';

import {
  initialNostrConnectWizardState,
  nostrConnectWizardReducer,
  type NostrConnectWizardAction,
  type NostrConnectWizardState,
} from '@/nostr/connectWizard';

const RELAYS = ['wss://a.example', 'wss://b.example', 'wss://c.example'];

const FAKE_OUTCOME = {
  profile: {
    event: { id: 'e1', pubkey: 'p', created_at: 1, kind: 30078, tags: [], content: '', sig: 's' },
    results: [{ relay: RELAYS[0]!, accepted: true, message: 'ok', elapsedMs: 1 }],
    acceptedCount: 1,
    requiredCount: 1,
    success: true,
  },
  kind0: {
    event: { id: 'e2', pubkey: 'p', created_at: 1, kind: 0, tags: [], content: '{}', sig: 's' },
    results: [
      { relay: RELAYS[0]!, accepted: true, message: 'ok', elapsedMs: 1 },
      { relay: RELAYS[1]!, accepted: false, message: 'rejected: test', elapsedMs: 1 },
    ],
    acceptedCount: 1,
    requiredCount: 2,
    success: false,
  },
} as const;

function dispatch(
  state: NostrConnectWizardState,
  ...actions: readonly NostrConnectWizardAction[]
): NostrConnectWizardState {
  return actions.reduce(nostrConnectWizardReducer, state);
}

describe('initialNostrConnectWizardState', () => {
  it('seeds exactly the caller-provided relays, idle/chooseMethod, everything else empty', () => {
    const s = initialNostrConnectWizardState(RELAYS);
    expect(s).toEqual({
      status: 'idle',
      step: 'chooseMethod',
      method: null,
      nsecInput: '',
      npub: null,
      relays: RELAYS,
      outcome: null,
      errorMessage: null,
      errorStage: null,
    });
  });
});

describe('happy path — mnemonic method', () => {
  it('chooseMnemonic -> provisioning -> provisioningSucceeded -> confirmPublish -> publishing -> published', () => {
    const start = initialNostrConnectWizardState(RELAYS);

    const provisioning = dispatch(start, { type: 'chooseMnemonic' });
    expect(provisioning.status).toBe('provisioning');
    expect(provisioning.method).toBe('mnemonic');

    const confirmRelays = dispatch(provisioning, { type: 'provisioningSucceeded', npub: 'npub1abc' });
    expect(confirmRelays.status).toBe('idle');
    expect(confirmRelays.step).toBe('confirmRelays');
    expect(confirmRelays.npub).toBe('npub1abc');
    expect(confirmRelays.relays).toEqual(RELAYS);

    const publishing = dispatch(confirmRelays, { type: 'confirmPublish' });
    expect(publishing.status).toBe('publishing');

    const published = dispatch(publishing, { type: 'publishingSucceeded', outcome: FAKE_OUTCOME });
    expect(published.status).toBe('published');
    expect(published.outcome).toEqual(FAKE_OUTCOME);
    // npub/relays survive into the published state (evidence still visible).
    expect(published.npub).toBe('npub1abc');
  });
});

describe('happy path — nsec method', () => {
  it('chooseNsec -> setNsecInput -> submitNsec -> provisioning -> provisioningSucceeded -> confirmRelays', () => {
    const start = initialNostrConnectWizardState(RELAYS);

    const pasteStep = dispatch(start, { type: 'chooseNsec' });
    expect(pasteStep.step).toBe('pasteNsec');
    expect(pasteStep.status).toBe('idle');

    const typed = dispatch(pasteStep, { type: 'setNsecInput', value: 'nsec1xyz' });
    expect(typed.nsecInput).toBe('nsec1xyz');

    const provisioning = dispatch(typed, { type: 'submitNsec' });
    expect(provisioning.status).toBe('provisioning');
    expect(provisioning.method).toBe('nsec');
    // Input preserved through the async call (screen still shows what was submitted).
    expect(provisioning.nsecInput).toBe('nsec1xyz');

    const confirmRelays = dispatch(provisioning, { type: 'provisioningSucceeded', npub: 'npub1xyz' });
    expect(confirmRelays.step).toBe('confirmRelays');
    expect(confirmRelays.npub).toBe('npub1xyz');
  });

  it('submitNsec is a no-op on empty/whitespace-only input (stays on pasteNsec)', () => {
    const pasteStep = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseNsec' });
    const blank = dispatch(pasteStep, { type: 'setNsecInput', value: '   ' });
    const after = dispatch(blank, { type: 'submitNsec' });
    expect(after.status).toBe('idle');
    expect(after.step).toBe('pasteNsec');
  });

  it('backToChooseMethod clears the nsec input and returns to chooseMethod', () => {
    const pasteStep = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseNsec' });
    const typed = dispatch(pasteStep, { type: 'setNsecInput', value: 'nsec1partial' });
    const back = dispatch(typed, { type: 'backToChooseMethod' });
    expect(back.step).toBe('chooseMethod');
    expect(back.nsecInput).toBe('');
  });
});

describe('already-provisioned fast path', () => {
  it('provisioningSucceeded dispatched from idle/chooseMethod (mount-time detection) jumps straight to confirmRelays', () => {
    // The screen dispatches this on mount when `hasNostrKey()` is already
    // true — no `chooseMnemonic`/`chooseNsec` ever fires.
    const start = initialNostrConnectWizardState(RELAYS);
    const confirmRelays = dispatch(start, { type: 'provisioningSucceeded', npub: 'npub1already' });
    expect(confirmRelays.status).toBe('idle');
    expect(confirmRelays.step).toBe('confirmRelays');
    expect(confirmRelays.npub).toBe('npub1already');
  });
});

describe('provisioning failure + retry routing', () => {
  it('provisioningFailed from the mnemonic method -> error(provisioning); retry -> chooseMethod', () => {
    const provisioning = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseMnemonic' });
    const errored = dispatch(provisioning, { type: 'provisioningFailed', message: 'derivedScalarOutOfRange' });
    expect(errored.status).toBe('error');
    expect(errored.errorStage).toBe('provisioning');
    expect(errored.errorMessage).toBe('derivedScalarOutOfRange');

    const retried = dispatch(errored, { type: 'retry' });
    expect(retried.status).toBe('idle');
    expect(retried.step).toBe('chooseMethod');
    expect(retried.errorMessage).toBeNull();
    expect(retried.errorStage).toBeNull();
  });

  it('provisioningFailed from the nsec method -> error(provisioning); retry -> pasteNsec (input preserved)', () => {
    const pasteStep = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseNsec' });
    const typed = dispatch(pasteStep, { type: 'setNsecInput', value: 'nsec1bad' });
    const provisioning = dispatch(typed, { type: 'submitNsec' });
    const errored = dispatch(provisioning, { type: 'provisioningFailed', message: 'invalidNsec: malformed bech32' });
    expect(errored.status).toBe('error');
    expect(errored.errorStage).toBe('provisioning');

    const retried = dispatch(errored, { type: 'retry' });
    expect(retried.step).toBe('pasteNsec');
    expect(retried.nsecInput).toBe('nsec1bad');
  });
});

describe('provisioningCancelled — Face-ID decline is not an alarming error', () => {
  it('returns silently to chooseMethod (mnemonic) without ever setting errorMessage', () => {
    const provisioning = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseMnemonic' });
    const cancelled = dispatch(provisioning, { type: 'provisioningCancelled' });
    expect(cancelled.status).toBe('idle');
    expect(cancelled.step).toBe('chooseMethod');
    expect(cancelled.errorMessage).toBeNull();
    expect(cancelled.errorStage).toBeNull();
  });

  it('returns to pasteNsec (not chooseMethod) when the nsec method was cancelled', () => {
    const pasteStep = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseNsec' });
    const typed = dispatch(pasteStep, { type: 'setNsecInput', value: 'nsec1inprogress' });
    const provisioning = dispatch(typed, { type: 'submitNsec' });
    const cancelled = dispatch(provisioning, { type: 'provisioningCancelled' });
    expect(cancelled.step).toBe('pasteNsec');
    expect(cancelled.nsecInput).toBe('nsec1inprogress');
  });
});

describe('publishing failure + retry routing', () => {
  it('publishingFailed -> error(publishing); retry -> confirmRelays, npub/relays preserved', () => {
    const provisioning = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseMnemonic' });
    const confirmRelays = dispatch(provisioning, { type: 'provisioningSucceeded', npub: 'npub1abc' });
    const publishing = dispatch(confirmRelays, { type: 'confirmPublish' });
    const errored = dispatch(publishing, { type: 'publishingFailed', message: 'publishToNostr: relays list is empty' });
    expect(errored.status).toBe('error');
    expect(errored.errorStage).toBe('publishing');
    expect(errored.npub).toBe('npub1abc');

    const retried = dispatch(errored, { type: 'retry' });
    expect(retried.status).toBe('idle');
    expect(retried.step).toBe('confirmRelays');
    expect(retried.npub).toBe('npub1abc');
    expect(retried.relays).toEqual(RELAYS);
    expect(retried.errorMessage).toBeNull();
  });
});

describe('guarded no-ops — inapplicable actions never corrupt state', () => {
  it('chooseMnemonic/chooseNsec while already provisioning is a no-op', () => {
    const provisioning = dispatch(initialNostrConnectWizardState(RELAYS), { type: 'chooseMnemonic' });
    expect(dispatch(provisioning, { type: 'chooseMnemonic' })).toEqual(provisioning);
    expect(dispatch(provisioning, { type: 'chooseNsec' })).toEqual(provisioning);
  });

  it('setNsecInput while on chooseMethod (not pasteNsec) is a no-op', () => {
    const start = initialNostrConnectWizardState(RELAYS);
    expect(dispatch(start, { type: 'setNsecInput', value: 'nsec1x' })).toEqual(start);
  });

  it('confirmPublish while on chooseMethod is a no-op', () => {
    const start = initialNostrConnectWizardState(RELAYS);
    expect(dispatch(start, { type: 'confirmPublish' })).toEqual(start);
  });

  it('provisioningFailed while idle (nothing in flight) is a no-op', () => {
    const start = initialNostrConnectWizardState(RELAYS);
    expect(dispatch(start, { type: 'provisioningFailed', message: 'x' })).toEqual(start);
  });

  it('publishingSucceeded while idle is a no-op', () => {
    const start = initialNostrConnectWizardState(RELAYS);
    expect(dispatch(start, { type: 'publishingSucceeded', outcome: FAKE_OUTCOME })).toEqual(start);
  });

  it('retry while not in error is a no-op', () => {
    const start = initialNostrConnectWizardState(RELAYS);
    expect(dispatch(start, { type: 'retry' })).toEqual(start);
  });
});
