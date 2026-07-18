/**
 * Card Exchange section — A5.2 (US-20). Renders on a Verified Page detail
 * screen (`app/people/profile/[did].tsx`) for a peer this device has
 * already verified and saved, offering the Pear v1 full-card exchange in
 * BOTH directions:
 *
 *   - "Request full card" — REQUESTER: pull `did`'s current full card
 *     (their signed profile JWS) over an authenticated Pear channel. See
 *     `useCardExchange.ts`'s `useCardRequestFlow` for the
 *     connecting→authenticating→requesting→received/declined/error state
 *     machine this drives.
 *   - "Make me reachable" toggle — RESPONDER, scoped to THIS peer only.
 *     See `useCardExchange.ts`'s module doc for why v1 can't offer a
 *     general "reachable to anyone" toggle, and for the honest "only while
 *     this screen stays open" lifecycle.
 *
 * `peerLabel` (`cardRelease.ts`'s `formatPeerLabel`) is computed ONCE here
 * from data this device already verified for `did` (the saved
 * `VerifiedSnapshot.record.displayName`, or the short did) — this is the
 * ONLY display text `useReachableMode` ever shows on the consent sheet for
 * "who is asking to release your card", per CLAUDE.md rule 8.
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ToggleRow } from '@/components/settings/SettingRow';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useProfileSnapshotStore } from '@/people/profileSnapshots';
import { snapshotMergeToast } from '@/people/snapshotMergeCopy';
import { formatPeerLabel } from '@/pear/cardRelease';
import { CARD_REQUEST_ERROR_I18N_SUFFIX, type CardRequestPhase } from '@/pear/cardRequestState';
import type { PresentRequestErrorKind, PresentRequestPhase } from '@/pear/presentRequestState';
import {
  useCardRequestFlow,
  useReachableMode,
  type ReachableErrorKind,
  type ReachableStatus,
} from '@/pear/useCardExchange';
import { useMutualCardExchange, type MutualExchangePhase } from '@/pear/useMutualCardExchange';
import { usePresentRequestFlow } from '@/pear/usePresentRequestFlow';
import { usePreferences } from '@/settings/preferences';

import { VerifiedProfileView } from '@/components/scan/VerifiedProfileView';

/** Claim types this screen asks a peer to prove — see A5.3's report for
 *  what's actually presentable today (passport claims backed by a
 *  non-ZK/`sd-jwt-fallback` credential; ZK-backed passport claims are
 *  filtered out by `presentBuilder.ts`'s `matchPresentableClaims` and read
 *  as an honest decline). Module-level constant so `usePresentRequestFlow`
 *  gets a stable array reference across renders. */
const PRESENT_CLAIMS: readonly string[] = ['age_over_18'];

export interface CardExchangeSectionProps {
  readonly did: string;
  readonly verifiedDisplayName: string;
}

/** Same pattern as `CARD_REQUEST_ERROR_I18N_SUFFIX` (`cardRequestState.ts`), for the reachable
 *  (responder) side — no raw diagnostic text ever reaches the UI, only a
 *  kind-keyed friendly string. See `useCardExchange.ts`'s
 *  `ReachableErrorKind` doc for what each kind actually means. */
const REACHABLE_ERROR_I18N_SUFFIX: Readonly<Record<ReachableErrorKind, string>> = {
  connection: 'connection',
  protocol: 'protocol',
};

/** Same pattern as `CARD_REQUEST_ERROR_I18N_SUFFIX` above, for A5.3's present-request
 *  (requester) side — includes the extra `'verification'` kind for a local
 *  `verifyVpToken` failure, which `CardRequestErrorKind` has no analogue
 *  for (the card flow's verification happens inside `protocol.ts` itself). */
const PRESENT_ERROR_I18N_SUFFIX: Readonly<Record<PresentRequestErrorKind, string>> = {
  declined: 'declined',
  timeout: 'timeout',
  malformed: 'malformed',
  verification: 'verification',
  protocol: 'protocol',
  connection: 'connection',
  authentication: 'authentication',
};

function requestButtonLabel(phase: CardRequestPhase, t: (key: string) => string): string {
  switch (phase.kind) {
    case 'connecting':
      return t('pearExchange.request.state.connecting');
    case 'authenticating':
      return t('pearExchange.request.state.authenticating');
    case 'requesting':
      return t('pearExchange.request.state.requesting');
    case 'received':
    case 'declined':
    case 'error':
      return t('pearExchange.request.retry');
    case 'idle':
      return t('pearExchange.request.button');
  }
}

function RequestStatusLine({ phase, t }: { readonly phase: CardRequestPhase; readonly t: (key: string) => string }): ReactNode {
  if (phase.kind === 'declined') {
    return (
      <ThemedText variant="caption" tone="secondary">
        {t('pearExchange.request.declinedMessage')}
      </ThemedText>
    );
  }
  if (phase.kind === 'error') {
    return (
      <ThemedText variant="caption" tone="error">
        {t(`pearExchange.request.error.${CARD_REQUEST_ERROR_I18N_SUFFIX[phase.error.kind]}`)}
      </ThemedText>
    );
  }
  return null;
}

function mutualButtonLabel(phase: MutualExchangePhase, t: (key: string) => string): string {
  switch (phase.kind) {
    case 'connecting':
      return t('pearExchange.mutual.state.connecting');
    case 'authenticating':
      return t('pearExchange.mutual.state.authenticating');
    case 'exchanging':
      return t('pearExchange.mutual.state.exchanging');
    case 'done':
    case 'declined':
    case 'error':
      return t('pearExchange.mutual.retry');
    case 'idle':
      return t('pearExchange.mutual.button');
  }
}

/** The two INDEPENDENT honesty axes of a completed exchange, never conflated
 *  (research §5): what WE saved locally, and what the PEER told us they did —
 *  including the distinct "no confirmation yet" (`unknown`) state that a
 *  dropped/late receipt produces. */
function MutualResultView({
  phase,
  t,
}: {
  readonly phase: Extract<MutualExchangePhase, { kind: 'done' }>;
  readonly t: (key: string) => string;
}): ReactNode {
  const peerUnknown = phase.result.peerReceipt === 'unknown';
  return (
    <ThemedSurface variant="inset" padded style={{ gap: 6 }}>
      <ThemedText variant="label" tone="secondary">
        {t('pearExchange.mutual.result.title')}
      </ThemedText>
      <ThemedText variant="caption" tone="tertiary">
        {t(`pearExchange.mutual.localSave.${phase.result.localSave}`)}
      </ThemedText>
      <ThemedText variant="caption" tone={peerUnknown ? 'secondary' : 'tertiary'}>
        {t(`pearExchange.mutual.peer.${phase.result.peerReceipt}`)}
      </ThemedText>
    </ThemedSurface>
  );
}

function MutualStatusLine({ phase, t }: { readonly phase: MutualExchangePhase; readonly t: (key: string) => string }): ReactNode {
  if (phase.kind === 'declined') {
    return (
      <ThemedText variant="caption" tone="secondary">
        {t('pearExchange.mutual.declinedMessage')}
      </ThemedText>
    );
  }
  if (phase.kind === 'error') {
    return (
      <ThemedText variant="caption" tone="error">
        {t(`pearExchange.mutual.error.${CARD_REQUEST_ERROR_I18N_SUFFIX[phase.error.kind]}`)}
      </ThemedText>
    );
  }
  return null;
}

function presentButtonLabel(phase: PresentRequestPhase, t: (key: string) => string): string {
  switch (phase.kind) {
    case 'connecting':
      return t('pearExchange.present.state.connecting');
    case 'authenticating':
      return t('pearExchange.present.state.authenticating');
    case 'requesting':
      return t('pearExchange.present.state.requesting');
    case 'verified':
    case 'declined':
    case 'error':
      return t('pearExchange.present.retry');
    case 'idle':
      return t('pearExchange.present.button');
  }
}

function PresentStatusLine({
  phase,
  t,
}: {
  readonly phase: PresentRequestPhase;
  readonly t: (key: string) => string;
}): ReactNode {
  if (phase.kind === 'declined') {
    return (
      <ThemedText variant="caption" tone="secondary">
        {t('pearExchange.present.declinedMessage')}
      </ThemedText>
    );
  }
  if (phase.kind === 'error') {
    return (
      <ThemedText variant="caption" tone="error">
        {t(`pearExchange.present.error.${PRESENT_ERROR_I18N_SUFFIX[phase.error.kind]}`)}
      </ThemedText>
    );
  }
  return null;
}

/** Renders ONLY what `verifyVpToken` actually proved — holder + each
 *  embedded credential's issuer/trust level. Never renders raw claim
 *  values that would need semantic interpretation this component doesn't
 *  have (CLAUDE.md rule 8: don't claim to know something we didn't check). */
function PresentVerifiedView({
  phase,
  t,
}: {
  readonly phase: Extract<PresentRequestPhase, { kind: 'verified' }>;
  readonly t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactNode {
  return (
    <ThemedSurface variant="inset" padded style={{ gap: 6 }}>
      <ThemedText variant="label" tone="secondary">
        {t('pearExchange.present.verified.title')}
      </ThemedText>
      <ThemedText variant="caption" tone="tertiary">
        {t('pearExchange.present.verified.holder', { did: phase.verified.holderDid })}
      </ThemedText>
      {phase.verified.credentials.map((c, i) => (
        <ThemedText key={`${String(i)}-${c.issuerDid}`} variant="caption" tone="tertiary">
          {t('pearExchange.present.verified.credential', {
            index: i + 1,
            issuer: c.issuerDid,
            trust: c.trustLevel,
          })}
        </ThemedText>
      ))}
    </ThemedSurface>
  );
}

function reachableStatusLine(status: ReachableStatus, t: (key: string, opts?: Record<string, unknown>) => string): string | null {
  switch (status.kind) {
    case 'off':
      return null;
    case 'listening':
      return t('pearExchange.reachable.state.listening');
    case 'authenticating':
      return t('pearExchange.reachable.state.authenticating');
    case 'ready':
      return t('pearExchange.reachable.state.ready');
    case 'error':
      return t(`pearExchange.reachable.state.error.${REACHABLE_ERROR_I18N_SUFFIX[status.errorKind]}`);
  }
}

export function CardExchangeSection(props: CardExchangeSectionProps): ReactNode {
  const pearEnabled = usePreferences((state) => state.pearExchangeEnabled);
  return pearEnabled ? <EnabledCardExchangeSection {...props} /> : <DisabledPearExchange />;
}

function DisabledPearExchange(): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      <ThemedText variant="label" tone="tertiary">
        {t('pearExchange.sectionTitle')}
      </ThemedText>
      <ThemedSurface variant="outlined" padded style={{ gap: 12 }}>
        <ThemedText variant="bodySmall" tone="secondary">
          {t('pearExchange.disabledMessage')}
        </ThemedText>
        <ThemedButton
          label={t('pearExchange.openSettings')}
          variant="secondary"
          fullWidth
          onPress={() => {
            router.push('/settings/connections');
          }}
        />
      </ThemedSurface>
    </View>
  );
}

function EnabledCardExchangeSection({ did, verifiedDisplayName }: CardExchangeSectionProps): ReactNode {
  const { t } = useTranslation();
  const peerLabel = formatPeerLabel(did, verifiedDisplayName);
  const requestFlow = useCardRequestFlow(did);
  const presentFlow = usePresentRequestFlow(did, PRESENT_CLAIMS);
  const exchangeFlow = useMutualCardExchange(did);
  const reachable = useReachableMode(did, peerLabel);
  const mergeVerified = useProfileSnapshotStore((s) => s.mergeVerified);
  const [saving, setSaving] = useState(false);

  const phase = requestFlow.phase;
  const requestBusy = phase.kind === 'connecting' || phase.kind === 'authenticating' || phase.kind === 'requesting';
  const exchangePhase = exchangeFlow.phase;
  const exchangeBusy =
    exchangePhase.kind === 'connecting' ||
    exchangePhase.kind === 'authenticating' ||
    exchangePhase.kind === 'exchanging';
  const presentPhase = presentFlow.phase;
  const presentBusy =
    presentPhase.kind === 'connecting' ||
    presentPhase.kind === 'authenticating' ||
    presentPhase.kind === 'requesting';
  const reachableOn = reachable.status.kind !== 'off' && reachable.status.kind !== 'error';
  const reachableLine = reachableStatusLine(reachable.status, t);

  const onSaveReceived = (): void => {
    if (phase.kind !== 'received' || saving) return;
    setSaving(true);
    // Unlike `VerifiedPageResultSheet`'s scan flow, no "already saved,
    // update?" confirm here — this screen only ever renders for a peer
    // that's ALREADY a saved `VerifiedSnapshot` (that's how the user
    // navigated here), so an update is always the intended outcome, not a
    // surprising side effect worth double-confirming.
    const outcome = mergeVerified(phase.record, phase.cardJws);
    setSaving(false);
    const toast = snapshotMergeToast(outcome.kind);
    pushToast(t(toast.i18nKey), toast.tone);
    requestFlow.reset();
  };

  return (
    <View style={{ gap: 16 }}>
      <ThemedText variant="label" tone="tertiary">
        {t('pearExchange.sectionTitle')}
      </ThemedText>

      <ThemedSurface variant="outlined" padded style={{ gap: 12 }}>
        <ThemedButton
          label={requestButtonLabel(phase, t)}
          variant="secondary"
          fullWidth
          loading={requestBusy}
          disabled={requestBusy}
          leadingIcon={<SfIcon name="arrow.down.circle" size={16} color={Colors.text1} />}
          onPress={() => {
            requestFlow.start();
          }}
        />
        <RequestStatusLine phase={phase} t={t} />
        {phase.kind === 'received' ? (
          <View style={{ gap: 12 }}>
            <VerifiedProfileView record={phase.record} />
            <ThemedButton
              label={t('verifiedPage.updateInPeople')}
              variant="primary"
              fullWidth
              loading={saving}
              leadingIcon={<SfIcon name="person.badge.plus" size={16} color={Colors.pageBg} />}
              onPress={onSaveReceived}
            />
          </View>
        ) : null}
      </ThemedSurface>

      <ThemedSurface variant="outlined" padded style={{ gap: 12 }}>
        <ThemedButton
          label={mutualButtonLabel(exchangePhase, t)}
          variant="secondary"
          fullWidth
          loading={exchangeBusy}
          disabled={exchangeBusy}
          leadingIcon={<SfIcon name="arrow.left.arrow.right.circle" size={16} color={Colors.text1} />}
          onPress={() => {
            exchangeFlow.start();
          }}
        />
        <ThemedText variant="caption" tone="tertiary">
          {t('pearExchange.mutual.subtitle', { name: peerLabel })}
        </ThemedText>
        <MutualStatusLine phase={exchangePhase} t={t} />
        {exchangePhase.kind === 'done' ? <MutualResultView phase={exchangePhase} t={t} /> : null}
      </ThemedSurface>

      <ThemedSurface variant="outlined" padded style={{ gap: 12 }}>
        <ThemedButton
          label={presentButtonLabel(presentPhase, t)}
          variant="secondary"
          fullWidth
          loading={presentBusy}
          disabled={presentBusy}
          leadingIcon={<SfIcon name="checkmark.shield" size={16} color={Colors.text1} />}
          onPress={() => {
            presentFlow.start();
          }}
        />
        <PresentStatusLine phase={presentPhase} t={t} />
        {presentPhase.kind === 'verified' ? <PresentVerifiedView phase={presentPhase} t={t} /> : null}
      </ThemedSurface>

      <ThemedSurface variant="outlined" padded style={{ gap: 8 }}>
        <ToggleRow
          label={t('pearExchange.reachable.label', { name: peerLabel })}
          value={reachableOn}
          onChange={() => {
            reachable.toggle();
          }}
        />
        <ThemedText variant="caption" tone="tertiary">
          {t('pearExchange.reachable.subtitle', { name: peerLabel })}
        </ThemedText>
        {reachableLine ? (
          <ThemedText variant="caption" tone={reachable.status.kind === 'error' ? 'error' : 'secondary'}>
            {reachableLine}
          </ThemedText>
        ) : null}
      </ThemedSurface>
    </View>
  );
}
