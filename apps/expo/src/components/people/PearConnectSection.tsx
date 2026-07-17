/**
 * Pear "connect privately" landing — Task A5.4 (US-20). Renders on
 * `/people/profile/[did]` (`app/people/profile/[did].tsx`) when that screen
 * is opened for a `did` this device has NOT already verified/saved (no
 * `VerifiedSnapshot`) — the landing surface for a `solidarity://pear/<did>`
 * deep link (the public web viewer's "Request private view" button), and
 * for any other route to an as-yet-unknown did.
 *
 * HONESTY (CLAUDE.md rule 8 + this task's brief): the did carried by a deep
 * link is UNVERIFIED input until the Pear handshake cryptographically
 * proves the peer controls it (`handshake.ts`'s `authenticateChannel`).
 * This component therefore NEVER shows a display name for `did` — only the
 * short did form, framed as "attempting to connect", never as an already-
 * verified identity — until `useCardRequestFlow`'s `received` phase. At
 * that point the received card's signature has already been verified
 * against `did` itself (`useCardExchange.ts`'s `verifyCompact(cardJws,
 * peerDid)`, run before the phase transitions), so showing the record then
 * IS backed by a cryptographic check, not the deep link's say-so.
 *
 * Mirrors `CardExchangeSection.tsx`'s REQUESTER half — see that module's
 * doc for `useCardRequestFlow`'s connecting→authenticating→requesting→
 * received/declined/error machine and why Face ID is only prompted once
 * (this device's own challenge-response signature, inside
 * `authenticateChannel`). Deliberately does NOT offer the "make me
 * reachable" toggle or a present-request button here: those make sense once
 * the two devices already know each other (the full `CardExchangeSection`
 * surface this same route switches to once a card is saved) — see A5.2's
 * module doc point 1 for why "reachable" is scoped to an already-known
 * peer, not a stranger from a deep link (v1 has no anonymous responder).
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { shortDid } from '@/components/id/shortDid';
import { VerifiedProfileView } from '@/components/scan/VerifiedProfileView';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useProfileSnapshotStore } from '@/people/profileSnapshots';
import { CARD_REQUEST_ERROR_I18N_SUFFIX, type CardRequestPhase } from '@/pear/cardRequestState';
import { useCardRequestFlow } from '@/pear/useCardExchange';
import { usePreferences } from '@/settings/preferences';

export interface PearConnectSectionProps {
  readonly did: string;
}

function connectButtonLabel(phase: CardRequestPhase, t: (key: string) => string): string {
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
      return t('pearConnect.retry');
    case 'idle':
      return t('pearConnect.button');
  }
}

export function PearConnectSection(props: PearConnectSectionProps): ReactNode {
  const pearEnabled = usePreferences((state) => state.pearExchangeEnabled);
  return pearEnabled ? <EnabledPearConnectSection {...props} /> : <DisabledPearConnectSection />;
}

function DisabledPearConnectSection(): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 16 }}>
      <ThemedText variant="titleMedium">{t('pearConnect.title')}</ThemedText>
      <ThemedSurface variant="outlined" padded style={{ gap: 12 }}>
        <ThemedText variant="bodyMedium" tone="secondary">
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

function EnabledPearConnectSection({ did }: PearConnectSectionProps): ReactNode {
  const { t } = useTranslation();
  const requestFlow = useCardRequestFlow(did);
  const upsert = useProfileSnapshotStore((s) => s.upsert);
  const [saving, setSaving] = useState(false);

  const phase = requestFlow.phase;
  const busy = phase.kind === 'connecting' || phase.kind === 'authenticating' || phase.kind === 'requesting';

  const onSave = (): void => {
    if (phase.kind !== 'received' || saving) return;
    setSaving(true);
    upsert(phase.record, phase.cardJws);
    setSaving(false);
    pushToast(t('verifiedPage.saved'), 'success');
  };

  return (
    <View style={{ gap: 16 }}>
      <ThemedText variant="titleMedium">{t('pearConnect.title')}</ThemedText>
      <ThemedText variant="bodyMedium" tone="secondary">
        {t('pearConnect.subtitle', { did: shortDid(did) })}
      </ThemedText>

      <ThemedSurface variant="outlined" padded style={{ gap: 12 }}>
        <ThemedButton
          label={connectButtonLabel(phase, t)}
          variant="primary"
          fullWidth
          loading={busy}
          disabled={busy}
          leadingIcon={<SfIcon name="lock.shield" size={16} color={Colors.pageBg} />}
          onPress={() => {
            requestFlow.start();
          }}
        />
        {phase.kind === 'declined' ? (
          <ThemedText variant="caption" tone="secondary">
            {t('pearExchange.request.declinedMessage')}
          </ThemedText>
        ) : null}
        {phase.kind === 'error' ? (
          <ThemedText variant="caption" tone="error">
            {t(`pearExchange.request.error.${CARD_REQUEST_ERROR_I18N_SUFFIX[phase.error.kind]}`)}
          </ThemedText>
        ) : null}
        {phase.kind === 'received' ? (
          <View style={{ gap: 12 }}>
            <VerifiedProfileView record={phase.record} />
            <ThemedButton
              label={t('verifiedPage.saveToPeople')}
              variant="secondary"
              fullWidth
              loading={saving}
              leadingIcon={<SfIcon name="person.badge.plus" size={16} color={Colors.text1} />}
              onPress={onSave}
            />
          </View>
        ) : null}
      </ThemedSurface>
    </View>
  );
}
