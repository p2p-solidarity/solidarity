/**
 * Pure state machine for the advanced “Publish page” route.
 *
 * The normal path has one action: the screen checks for an existing device
 * key, provisions from the root mnemonic only when needed, and immediately
 * publishes to the app defaults. Importing an existing secret remains
 * available behind an explicit advanced disclosure. Relay reports are kept
 * as evidence, but an outcome earns `published` only when both existing
 * quorum flags passed.
 */
import type { NostrPublishOutcome } from '@/profile/store';
import type { Result } from '@solidarity/shared';

export type NostrConnectMethod = 'mnemonic' | 'nsec';
export type NostrConnectStep = 'ready' | 'pasteNsec';
export type NostrConnectStatus =
  | 'idle'
  | 'provisioning'
  | 'publishing'
  | 'published'
  | 'error';

export interface NostrConnectWizardState {
  readonly status: NostrConnectStatus;
  readonly step: NostrConnectStep;
  readonly method: NostrConnectMethod | null;
  readonly nsecInput: string;
  readonly outcome: NostrPublishOutcome | null;
  readonly errorMessage: string | null;
  readonly errorStage: 'provisioning' | 'publishing' | null;
}

export function initialNostrConnectWizardState(): NostrConnectWizardState {
  return {
    status: 'idle',
    step: 'ready',
    method: null,
    nsecInput: '',
    outcome: null,
    errorMessage: null,
    errorStage: null,
  };
}

export type NostrConnectWizardAction =
  | { readonly type: 'startProvisioning' }
  | { readonly type: 'startPublishing' }
  | { readonly type: 'showNsecImport' }
  | { readonly type: 'hideNsecImport' }
  | { readonly type: 'setNsecInput'; readonly value: string }
  | { readonly type: 'submitNsec' }
  | { readonly type: 'provisioningSucceeded' }
  | { readonly type: 'provisioningFailed'; readonly message: string }
  | { readonly type: 'provisioningCancelled' }
  | { readonly type: 'publishingSucceeded'; readonly outcome: NostrPublishOutcome }
  | { readonly type: 'publishingFailed'; readonly message: string }
  | { readonly type: 'retry' };

export function isNostrPublishOutcomeSuccessful(outcome: NostrPublishOutcome): boolean {
  return outcome.profile.success && outcome.kind0.success;
}

/** Covers the tagged provisioning result and saveProfile's stable mapping. */
export function isBiometricCancellation(message: string): boolean {
  return (
    message === 'biometricDenied' ||
    message.toLowerCase().includes('biometric authentication was denied')
  );
}

export interface NostrAutoSetupDependencies {
  readonly hasKey: () => Promise<boolean>;
  readonly provision: () => Promise<Result<string, string>>;
  readonly publish: () => Promise<Result<NostrPublishOutcome, string>>;
}

/**
 * User-tap-only orchestration shared by both page editors. It never runs on
 * mount, never changes the custody model, and provisions only after a real
 * key miss immediately before the requested publish.
 */
export async function publishWithNostrAutoSetup(
  dependencies: NostrAutoSetupDependencies
): Promise<Result<NostrPublishOutcome, string>> {
  try {
    if (!(await dependencies.hasKey())) {
      const provisioned = await dependencies.provision();
      if (!provisioned.ok) return provisioned;
    }
    return await dependencies.publish();
  } catch {
    return { ok: false, error: 'publishing setup is unavailable' };
  }
}

function startProvisioning(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'ready') return state;
  return {
    ...state,
    status: 'provisioning',
    method: 'mnemonic',
    outcome: null,
    errorMessage: null,
    errorStage: null,
  };
}

function startPublishing(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'ready') return state;
  return {
    ...state,
    status: 'publishing',
    outcome: null,
    errorMessage: null,
    errorStage: null,
  };
}

function showNsecImport(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'ready') return state;
  return { ...state, step: 'pasteNsec' };
}

function hideNsecImport(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'pasteNsec') return state;
  return { ...state, step: 'ready', method: null, nsecInput: '' };
}

function setNsecInput(state: NostrConnectWizardState, value: string): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'pasteNsec') return state;
  return { ...state, nsecInput: value };
}

function submitNsec(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'pasteNsec') return state;
  if (state.nsecInput.trim().length === 0) return state;
  return {
    ...state,
    status: 'provisioning',
    method: 'nsec',
    outcome: null,
    errorMessage: null,
    errorStage: null,
  };
}

function provisioningSucceeded(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'provisioning') return state;
  return { ...state, status: 'publishing', errorMessage: null, errorStage: null };
}

function provisioningFailed(
  state: NostrConnectWizardState,
  message: string
): NostrConnectWizardState {
  if (state.status !== 'provisioning') return state;
  return { ...state, status: 'error', errorStage: 'provisioning', errorMessage: message };
}

function provisioningCancelled(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'provisioning') return state;
  return {
    ...state,
    status: 'idle',
    step: state.method === 'nsec' ? 'pasteNsec' : 'ready',
    errorMessage: null,
    errorStage: null,
  };
}

function publishingSucceeded(
  state: NostrConnectWizardState,
  outcome: NostrPublishOutcome
): NostrConnectWizardState {
  if (state.status !== 'publishing') return state;
  if (!isNostrPublishOutcomeSuccessful(outcome)) {
    return {
      ...state,
      status: 'error',
      outcome,
      errorStage: 'publishing',
      errorMessage: 'publish quorum was not met',
    };
  }
  return { ...state, status: 'published', outcome, errorMessage: null, errorStage: null };
}

function publishingFailed(
  state: NostrConnectWizardState,
  message: string
): NostrConnectWizardState {
  if (state.status !== 'publishing') return state;
  return {
    ...state,
    status: 'error',
    outcome: null,
    errorStage: 'publishing',
    errorMessage: message,
  };
}

function retry(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'error') return state;
  const step =
    state.errorStage === 'provisioning' && state.method === 'nsec' ? 'pasteNsec' : 'ready';
  return {
    ...state,
    status: 'idle',
    step,
    outcome: null,
    errorMessage: null,
    errorStage: null,
  };
}

export function nostrConnectWizardReducer(
  state: NostrConnectWizardState,
  action: NostrConnectWizardAction
): NostrConnectWizardState {
  switch (action.type) {
    case 'startProvisioning':
      return startProvisioning(state);
    case 'startPublishing':
      return startPublishing(state);
    case 'showNsecImport':
      return showNsecImport(state);
    case 'hideNsecImport':
      return hideNsecImport(state);
    case 'setNsecInput':
      return setNsecInput(state, action.value);
    case 'submitNsec':
      return submitNsec(state);
    case 'provisioningSucceeded':
      return provisioningSucceeded(state);
    case 'provisioningFailed':
      return provisioningFailed(state, action.message);
    case 'provisioningCancelled':
      return provisioningCancelled(state);
    case 'publishingSucceeded':
      return publishingSucceeded(state, action.outcome);
    case 'publishingFailed':
      return publishingFailed(state, action.message);
    case 'retry':
      return retry(state);
  }
}
