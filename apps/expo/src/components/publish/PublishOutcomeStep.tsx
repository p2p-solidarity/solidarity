import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { isNostrPublishOutcomeSuccessful } from '@/nostr/connectWizard';
import { DEFAULT_RELAYS, type PublishReport } from '@/nostr/publish';
import type { NostrPublishOutcome } from '@/profile/store';

import {
  PublishingConstellation,
  type RelayNodeStatus,
} from './PublishingConstellation';

type TFn = ReturnType<typeof useTranslation>['t'];

export function PublishOutcomeStep({
  outcome,
  onDone,
}: {
  readonly outcome: NostrPublishOutcome;
  readonly onDone: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const fullyPublished = isNostrPublishOutcomeSuccessful(outcome);

  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <PublishingConstellation
          phase={fullyPublished ? 'published' : 'partial'}
          relayStatuses={relayNodeStatuses(outcome)}
        />
        <ThemedText variant="titleLarge">
          {t(fullyPublished ? 'nostrConnect.publishedTitle' : 'nostrConnect.partialTitle')}
        </ThemedText>
        <ThemedText variant="bodySmall" tone="secondary" style={{ textAlign: 'center' }}>
          {t(fullyPublished ? 'nostrConnect.publishedMessage' : 'nostrConnect.partialMessage')}
        </ThemedText>
      </View>
      <PressableScale
        haptic="tap"
        onPress={() => {
          setShowDetails((visible) => !visible);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetails }}
        accessibilityLabel={t('nostrConnect.details')}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <SfIcon name={showDetails ? 'chevron.down' : 'chevron.right'} size={12} color={Colors.text3} />
        <ThemedText variant="caption" tone="secondary">
          {t(showDetails ? 'nostrConnect.hideDetails' : 'nostrConnect.details')}
        </ThemedText>
      </PressableScale>
      {showDetails ? (
        <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
          <View style={{ gap: 16 }}>
            <RelayReportSection
              title={t('nostrConnect.profilePointerReport')}
              report={outcome.profile}
              t={t}
            />
            <RelayReportSection
              title={t('nostrConnect.kind0Report')}
              report={outcome.kind0}
              t={t}
            />
          </View>
        </ScrollView>
      ) : null}
      <ThemedButton
        label={t('nostrConnect.done')}
        variant="primary"
        fullWidth
        onPress={onDone}
      />
    </View>
  );
}

function RelayReportSection({
  title,
  report,
  t,
}: {
  readonly title: string;
  readonly report: PublishReport;
  readonly t: TFn;
}): ReactNode {
  return (
    <ThemedSurface variant="inset" className="rounded-none p-3">
      <View style={{ gap: 8 }}>
        <ThemedText variant="label">{title}</ThemedText>
        <ThemedText variant="caption" tone="secondary">
          {t('nostrConnect.acceptedSummary', {
            accepted: report.acceptedCount,
            total: report.results.length,
          })}
        </ThemedText>
        {report.results.map((result) => (
          <View key={result.relay} style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SfIcon
                name={result.accepted ? 'checkmark.circle.fill' : 'xmark.circle'}
                size={14}
                color={result.accepted ? Colors.terminalGreen : Colors.destructive}
              />
              <ThemedText
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                style={{ flex: 1, fontFamily: 'Menlo' }}>
                {result.relay}
              </ThemedText>
            </View>
            {!result.accepted && result.message.length > 0 ? (
              <ThemedText
                variant="caption"
                tone="tertiary"
                numberOfLines={2}
                style={{ marginLeft: 22, fontFamily: 'Menlo' }}>
                {result.message}
              </ThemedText>
            ) : null}
          </View>
        ))}
      </View>
    </ThemedSurface>
  );
}

export function relayNodeStatuses(outcome: NostrPublishOutcome): readonly RelayNodeStatus[] {
  return DEFAULT_RELAYS.slice(0, 3).map((relay) => {
    const profile = outcome.profile.results.find((result) => result.relay === relay);
    const binding = outcome.kind0.results.find((result) => result.relay === relay);
    return profile?.accepted === true && binding?.accepted === true ? 'accepted' : 'rejected';
  });
}
