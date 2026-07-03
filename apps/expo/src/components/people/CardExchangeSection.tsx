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
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ToggleRow } from '@/components/settings/SettingRow';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useProfileSnapshotStore } from '@/people/profileSnapshots';
import { formatPeerLabel } from '@/pear/cardRelease';
import type { CardRequestErrorKind, CardRequestPhase } from '@/pear/cardRequestState';
import {
  useCardRequestFlow,
  useReachableMode,
  type ReachableErrorKind,
  type ReachableStatus,
} from '@/pear/useCardExchange';

import { VerifiedProfileView } from '@/components/scan/VerifiedProfileView';

export interface CardExchangeSectionProps {
  readonly did: string;
  readonly verifiedDisplayName: string;
}

const ERROR_I18N_SUFFIX: Readonly<Record<CardRequestErrorKind, string>> = {
  declined: 'declined',
  timeout: 'timeout',
  malformed: 'malformed',
  verification: 'verification',
  protocol: 'protocol',
  connection: 'connection',
  authentication: 'authentication',
};

/** Same pattern as `ERROR_I18N_SUFFIX` above, for the reachable
 *  (responder) side — no raw diagnostic text ever reaches the UI, only a
 *  kind-keyed friendly string. See `useCardExchange.ts`'s
 *  `ReachableErrorKind` doc for what each kind actually means. */
const REACHABLE_ERROR_I18N_SUFFIX: Readonly<Record<ReachableErrorKind, string>> = {
  connection: 'connection',
  protocol: 'protocol',
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
        {t(`pearExchange.request.error.${ERROR_I18N_SUFFIX[phase.error.kind]}`)}
      </ThemedText>
    );
  }
  return null;
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

export function CardExchangeSection({ did, verifiedDisplayName }: CardExchangeSectionProps): ReactNode {
  const { t } = useTranslation();
  const peerLabel = formatPeerLabel(did, verifiedDisplayName);
  const requestFlow = useCardRequestFlow(did);
  const reachable = useReachableMode(did, peerLabel);
  const upsert = useProfileSnapshotStore((s) => s.upsert);
  const [saving, setSaving] = useState(false);

  const phase = requestFlow.phase;
  const requestBusy = phase.kind === 'connecting' || phase.kind === 'authenticating' || phase.kind === 'requesting';
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
    upsert(phase.record, phase.cardJws);
    setSaving(false);
    pushToast(t('verifiedPage.saved'), 'success');
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
