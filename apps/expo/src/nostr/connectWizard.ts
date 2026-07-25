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
import type { TFunction } from 'i18next';

import type { NostrPublishOutcome } from '@/profile/store';
import type { PublishReport } from '@/nostr/publish';
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

/**
 * Partial acceptance (user decision 2026-07-17, 04-plan S8f): the page is
 * genuinely live once at least one relay holds EACH copy — a verifier only
 * needs to find one relay carrying both the pointer and the kind-0 binding.
 * Both-copies is the floor, not either: a page copy with zero verification
 * copies would render a page whose green check can never resolve.
 * Full quorum stays the bar for the "published" success surface
 * (`isNostrPublishOutcomeSuccessful`); this only decides error-vs-partial.
 */
export function isNostrPublishOutcomePartiallyAccepted(outcome: NostrPublishOutcome): boolean {
  return outcome.profile.acceptedCount >= 1 && outcome.kind0.acceptedCount >= 1;
}

/**
 * i18n-coded per-relay rejection — a UI adapter formats it with the caller's
 * `t`. Carrying KEYS (not baked English) is the whole point: this module is a
 * pure state machine with no i18n import, and every surface must render the
 * same rejection line in the user's language rather than five hardcoded copies.
 */
export interface NostrRelayRejection {
  /** i18n key for the copy this relay rejected: `publishOutcome.copy.page`
   *  (30078 pointer) or `publishOutcome.copy.verification` (kind-0 binding). */
  readonly copyKey: NostrRejectionCopyKey;
  readonly relay: string;
  /** The relay's own OK/close message, or `null` when it never responded — the
   *  formatter substitutes the localized `publishOutcome.noResponse`. Quorum
   *  counts alone ("1 of 3") can't tell rate-limiting from a policy reject or a
   *  timeout; the relay's message is the only evidence, so it is carried here. */
  readonly message: string | null;
  readonly elapsedMs: number;
}

export type NostrRejectionCopyKey =
  | 'publishOutcome.copy.page'
  | 'publishOutcome.copy.verification';

/**
 * The single structured reading of ONE Nostr publish attempt that every
 * surface shares (audit R5#3 / R4). `full` and `partial` are BOTH live —
 * store semantics (04-plan S8f) are the decided truth: ≥1 relay holding each
 * copy = live; `full` additionally means both quorums passed. `none` = a copy
 * reached zero relays (never live). `cancelled` / `failed` cover the Result
 * error paths before any outcome exists (biometric cancel vs. a real error).
 */
export type NostrPublishClassification =
  | { readonly kind: 'full'; readonly outcome: NostrPublishOutcome }
  | {
      readonly kind: 'partial';
      readonly outcome: NostrPublishOutcome;
      readonly rejections: readonly NostrRelayRejection[];
    }
  | {
      readonly kind: 'none';
      readonly outcome: NostrPublishOutcome;
      readonly rejections: readonly NostrRelayRejection[];
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

/** i18n-coded per-relay rejections for both copies of a publish outcome. */
export function relayRejections(outcome: NostrPublishOutcome): readonly NostrRelayRejection[] {
  const forCopy = (copyKey: NostrRejectionCopyKey, report: PublishReport): NostrRelayRejection[] =>
    report.results
      .filter((result) => !result.accepted)
      .map((result) => ({
        copyKey,
        relay: result.relay,
        message: result.message.length > 0 ? result.message : null,
        elapsedMs: result.elapsedMs,
      }));
  return [
    ...forCopy('publishOutcome.copy.page', outcome.profile),
    ...forCopy('publishOutcome.copy.verification', outcome.kind0),
  ];
}

/**
 * Classify one publish attempt into the shared outcome union. This is the ONE
 * place the full/partial/none decision and the biometric-cancel-vs-error split
 * live; every surface adapts THIS rather than re-deriving quorum rules. Built
 * on the existing predicates so the store's marker
 * (`isNostrPublishOutcomePartiallyAccepted`) and the "published" success bar
 * (`isNostrPublishOutcomeSuccessful`) stay the single sources of the thresholds.
 */
export function classifyNostrPublishOutcome(
  result: Result<NostrPublishOutcome, string>
): NostrPublishClassification {
  if (!result.ok) {
    return isBiometricCancellation(result.error)
      ? { kind: 'cancelled' }
      : { kind: 'failed', message: result.error };
  }
  const outcome = result.value;
  if (isNostrPublishOutcomeSuccessful(outcome)) return { kind: 'full', outcome };
  const rejections = relayRejections(outcome);
  return isNostrPublishOutcomePartiallyAccepted(outcome)
    ? { kind: 'partial', outcome, rejections }
    : { kind: 'none', outcome, rejections };
}

/**
 * The shared "accept as published" test: the page is genuinely live on ≥1 relay
 * per copy. `bluesky` refresh and `websign` MUST use this (not full quorum) so
 * a partial publish reads as live exactly like the store marks it.
 */
export function isNostrPublishClassificationLive(
  classification: NostrPublishClassification
): classification is Extract<NostrPublishClassification, { kind: 'full' | 'partial' }> {
  return classification.kind === 'full' || classification.kind === 'partial';
}

/** Format one i18n-coded rejection into a display line via the caller's `t`. */
export function formatNostrRelayRejection(rejection: NostrRelayRejection, t: TFunction): string {
  return t('publishOutcome.relayRejectionLine', {
    copy: t(rejection.copyKey),
    relay: rejection.relay,
    message: rejection.message ?? t('publishOutcome.noResponse'),
    ms: Math.round(rejection.elapsedMs),
  });
}

/**
 * The multi-line failure trace every error-showing surface (verify/nostr,
 * PageStep, me/edit, websign) renders for a sub-quorum publish: the quorum
 * summary plus one localized line per rejecting relay.
 */
export function formatNostrPublishFailureDetail(outcome: NostrPublishOutcome, t: TFunction): string {
  return [
    t('nostrConnect.publishReportDetail', {
      profileAccepted: outcome.profile.acceptedCount,
      profileTotal: outcome.profile.results.length,
      bindingAccepted: outcome.kind0.acceptedCount,
      bindingTotal: outcome.kind0.results.length,
    }),
    ...relayRejections(outcome).map((rejection) => formatNostrRelayRejection(rejection, t)),
  ].join('\n');
}

/** Covers the tagged provisioning result and saveProfile's stable mapping. */
export function isBiometricCancellation(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message === 'biometricDenied' ||
    normalized.includes('biometric authentication was denied') ||
    normalized.includes('biometric authentication required')
  );
}

export interface NostrAutoSetupDependencies {
  readonly hasKey: () => Promise<boolean>;
  readonly provision: () => Promise<Result<string, string>>;
  readonly publish: () => Promise<Result<NostrPublishOutcome, string>>;
}

export interface NostrClaimPreparationDependencies {
  readonly hasKey: () => Promise<boolean>;
  readonly provision: () => Promise<Result<string, string>>;
  readonly getPubkey: () => Promise<Result<string, string>>;
  readonly encodeNpub: (pubkey: string) => Result<string, string>;
}

/**
 * Resolve the device's Nostr identity and merge its public claim into the
 * candidate profile fields before `saveProfile` signs any projection.
 * Callers invoke this only from an explicit Save action.
 */
export async function prepareNostrClaimForSave(
  alsoKnownAs: readonly string[],
  dependencies: NostrClaimPreparationDependencies
): Promise<Result<readonly string[], string>> {
  try {
    const pubkey = (await dependencies.hasKey())
      ? await dependencies.getPubkey()
      : await dependencies.provision();
    if (!pubkey.ok) return pubkey;
    const npub = dependencies.encodeNpub(pubkey.value);
    if (!npub.ok) return npub;
    const claim = `nostr:${npub.value}`;
    return {
      ok: true,
      value: alsoKnownAs.includes(claim) ? alsoKnownAs : [...alsoKnownAs, claim],
    };
  } catch {
    return { ok: false, error: 'publishing setup is unavailable' };
  }
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
  // Partial acceptance still lands on the outcome step (which renders the
  // honest per-relay partial panel); only a copy with ZERO acceptances is
  // an error — nothing usable reached any relay.
  if (!isNostrPublishOutcomePartiallyAccepted(outcome)) {
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
