/**
 * connectWizard.ts — pure state machine for the "Connect Nostr" binding
 * wizard (04-plan Phase A4 task A4.4; `app/verify/nostr.tsx`;
 * docs/ref/03-app-web-mechanisms.md §5's "我的徽章綁定管理(S/A/B/C 各平台
 * 精靈)"). No IO here — the screen dispatches actions in response to real
 * `userKey.ts` / `profile/store.ts` calls; this file only owns the
 * transition table, so it is fully unit-testable without React, Face ID,
 * or any relay (CLAUDE.md rule 8's spirit applied to logic: never fabricate
 * a state transition the screen didn't actually earn).
 *
 * Only `import type` from `@/profile/store` — this file must stay loadable
 * by bun's test runner without pulling in `expo-secure-store` /
 * `react-native` transitively (see `userKey.ts`'s module doc for the same
 * reasoning applied to its own lazy imports).
 *
 * ── The five screen-facing states (task A4.4's brief) ────────────────────
 *
 *   idle        — `step` distinguishes the three idle sub-screens:
 *                 `chooseMethod` (pick mnemonic-derive vs paste-nsec),
 *                 `pasteNsec` (nsec text entry), `confirmRelays` (relay
 *                 list shown for the pre-first-publish confirmation A4.2
 *                 requires, npub already resolved).
 *   provisioning — `provisionFromRootMnemonic()` (Face ID) or
 *                 `importNsec()` is in flight.
 *   publishing   — `publishToNostr(confirmedRelays)` is in flight.
 *   published    — carries the full `NostrPublishOutcome` (both
 *                 `PublishReport`s) so the screen can render the HONEST
 *                 per-relay result (e.g. "2 of 3 accepted"), never a bare
 *                 "done".
 *   error        — carries `errorMessage` + `errorStage` (which async step
 *                 failed) so `retry` can route back to the right idle
 *                 sub-screen instead of restarting the whole wizard.
 *
 * A Face-ID CANCEL (user declined biometrics) is deliberately NOT routed
 * through `provisioningFailed` — see `provisioningCancelled`'s doc below —
 * matching `app/settings/identity-export.tsx`'s existing treatment of the
 * same `biometricDenied` outcome (silent return, not an alarming error).
 */
import type { NostrPublishOutcome } from '@/profile/store';

export type NostrConnectMethod = 'mnemonic' | 'nsec';

/** Which sub-screen to render while `status === 'idle'`. */
export type NostrConnectStep = 'chooseMethod' | 'pasteNsec' | 'confirmRelays';

export type NostrConnectStatus = 'idle' | 'provisioning' | 'publishing' | 'published' | 'error';

export interface NostrConnectWizardState {
  readonly status: NostrConnectStatus;
  readonly step: NostrConnectStep;
  /** The method currently being (or last) attempted — drives `retry`'s routing. */
  readonly method: NostrConnectMethod | null;
  readonly nsecInput: string;
  /** Set once provisioning succeeds (this session, or detected already-provisioned on mount). */
  readonly npub: string | null;
  /** The relay list shown for confirmation / used to publish. Caller seeds this with `DEFAULT_RELAYS`. */
  readonly relays: readonly string[];
  /** Set once `status === 'published'`. */
  readonly outcome: NostrPublishOutcome | null;
  /** Set once `status === 'error'`. */
  readonly errorMessage: string | null;
  /** Which async step failed — set alongside `errorMessage`, read by `retry`. */
  readonly errorStage: 'provisioning' | 'publishing' | null;
}

export function initialNostrConnectWizardState(defaultRelays: readonly string[]): NostrConnectWizardState {
  return {
    status: 'idle',
    step: 'chooseMethod',
    method: null,
    nsecInput: '',
    npub: null,
    relays: defaultRelays,
    outcome: null,
    errorMessage: null,
    errorStage: null,
  };
}

export type NostrConnectWizardAction =
  | { readonly type: 'chooseMnemonic' }
  | { readonly type: 'chooseNsec' }
  | { readonly type: 'setNsecInput'; readonly value: string }
  | { readonly type: 'backToChooseMethod' }
  | { readonly type: 'submitNsec' }
  /** Already-provisioned-on-mount fast path, OR a successful provision/import. */
  | { readonly type: 'provisioningSucceeded'; readonly npub: string }
  | { readonly type: 'provisioningFailed'; readonly message: string }
  /** Face ID was cancelled/denied — return to `chooseMethod` without an alarming error (see module doc). */
  | { readonly type: 'provisioningCancelled' }
  | { readonly type: 'confirmPublish' }
  | { readonly type: 'publishingSucceeded'; readonly outcome: NostrPublishOutcome }
  | { readonly type: 'publishingFailed'; readonly message: string }
  | { readonly type: 'retry' };

// ── Per-action handlers — kept as small standalone functions (rather than
//    one large switch body) so each transition's guard stays trivially
//    readable and the dispatcher below stays a flat lookup. ────────────────

function handleChooseMnemonic(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'chooseMethod') return state;
  return { ...state, status: 'provisioning', method: 'mnemonic' };
}

function handleChooseNsec(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'chooseMethod') return state;
  return { ...state, step: 'pasteNsec' };
}

function handleSetNsecInput(state: NostrConnectWizardState, value: string): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'pasteNsec') return state;
  return { ...state, nsecInput: value };
}

function handleBackToChooseMethod(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'pasteNsec') return state;
  return { ...state, step: 'chooseMethod', nsecInput: '' };
}

function handleSubmitNsec(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'pasteNsec') return state;
  if (state.nsecInput.trim().length === 0) return state;
  return { ...state, status: 'provisioning', method: 'nsec' };
}

function handleProvisioningSucceeded(state: NostrConnectWizardState, npub: string): NostrConnectWizardState {
  if (state.status !== 'idle' && state.status !== 'provisioning') return state;
  return { ...state, status: 'idle', step: 'confirmRelays', npub, errorMessage: null, errorStage: null };
}

function handleProvisioningFailed(state: NostrConnectWizardState, message: string): NostrConnectWizardState {
  if (state.status !== 'provisioning') return state;
  return { ...state, status: 'error', errorStage: 'provisioning', errorMessage: message };
}

/** Face ID cancelled/denied — return silently, no `errorMessage` (see module doc). */
function handleProvisioningCancelled(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'provisioning') return state;
  return { ...state, status: 'idle', step: state.method === 'nsec' ? 'pasteNsec' : 'chooseMethod' };
}

function handleConfirmPublish(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'idle' || state.step !== 'confirmRelays') return state;
  return { ...state, status: 'publishing' };
}

function handlePublishingSucceeded(
  state: NostrConnectWizardState,
  outcome: NostrPublishOutcome
): NostrConnectWizardState {
  if (state.status !== 'publishing') return state;
  return { ...state, status: 'published', outcome };
}

function handlePublishingFailed(state: NostrConnectWizardState, message: string): NostrConnectWizardState {
  if (state.status !== 'publishing') return state;
  return { ...state, status: 'error', errorStage: 'publishing', errorMessage: message };
}

/**
 * A provisioning failure retries into the sub-step matching which method
 * was attempted; a publishing failure retries into `confirmRelays`
 * (npub/relays preserved) — the key is already provisioned, no need to
 * redo Face ID / re-paste an nsec just to retry the publish.
 */
function handleRetry(state: NostrConnectWizardState): NostrConnectWizardState {
  if (state.status !== 'error') return state;
  const step: NostrConnectStep =
    state.errorStage === 'provisioning' ? (state.method === 'nsec' ? 'pasteNsec' : 'chooseMethod') : 'confirmRelays';
  return { ...state, status: 'idle', step, errorMessage: null, errorStage: null };
}

/**
 * Pure transition function. Actions that don't apply to the current
 * `status`/`step` are no-ops (return `state` unchanged) rather than
 * throwing — a screen wired correctly never dispatches an inapplicable
 * action, but a stale closure firing after a fast double-tap must not
 * corrupt state.
 */
export function nostrConnectWizardReducer(
  state: NostrConnectWizardState,
  action: NostrConnectWizardAction
): NostrConnectWizardState {
  switch (action.type) {
    case 'chooseMnemonic':
      return handleChooseMnemonic(state);
    case 'chooseNsec':
      return handleChooseNsec(state);
    case 'setNsecInput':
      return handleSetNsecInput(state, action.value);
    case 'backToChooseMethod':
      return handleBackToChooseMethod(state);
    case 'submitNsec':
      return handleSubmitNsec(state);
    case 'provisioningSucceeded':
      return handleProvisioningSucceeded(state, action.npub);
    case 'provisioningFailed':
      return handleProvisioningFailed(state, action.message);
    case 'provisioningCancelled':
      return handleProvisioningCancelled(state);
    case 'confirmPublish':
      return handleConfirmPublish(state);
    case 'publishingSucceeded':
      return handlePublishingSucceeded(state, action.outcome);
    case 'publishingFailed':
      return handlePublishingFailed(state, action.message);
    case 'retry':
      return handleRetry(state);
  }
}
