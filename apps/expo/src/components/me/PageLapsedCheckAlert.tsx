import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { View } from 'react-native';

import {
  getBadgeStatusCacheRevision,
  readCachedAtprotoResult,
  readCachedNostrResult,
  subscribeBadgeStatusCache,
} from '@/badges/badgeStatusCache';
import { PressableScale } from '@/components/common/PressableScale';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { syncLapsedAlert, type LapsedEvidence } from '@/page/pageDesign';
import { usePageDesignStore } from '@/page/pageDesignStore';
import type { ProfileRecord } from '@solidarity/shared';

export function PageLapsedCheckAlert({
  record,
  nostrUploaded,
}: {
  readonly record: ProfileRecord;
  readonly nostrUploaded: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const revision = useSyncExternalStore(
    subscribeBadgeStatusCache,
    getBadgeStatusCacheRevision,
    getBadgeStatusCacheRevision
  );
  const publishedPageLabel = t('pageDesign.publishedPage');
  const evidence = useMemo(
    () => lapsedEvidenceFor(record, nostrUploaded, publishedPageLabel),
    [nostrUploaded, publishedPageLabel, record, revision]
  );
  const persistence = usePageDesignStore((state) => state.design.lapsedAlert);
  const syncLapsedEvidence = usePageDesignStore((state) => state.syncLapsedEvidence);
  const dismissLapsedAlert = usePageDesignStore((state) => state.dismissLapsedAlert);
  const model = syncLapsedAlert(persistence, evidence);

  useEffect(() => {
    syncLapsedEvidence(evidence);
  }, [evidence, syncLapsedEvidence]);

  if (!model.visible) return null;
  const names = evidence.map(({ label }) => label).join(', ');

  return (
    <ThemedSurface
      variant="card"
      className="mx-4 flex-row items-center gap-3 p-3"
      style={{ borderColor: Colors.warning }}>
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodyMedium">{t('pageDesign.lapsedTitle', { names })}</ThemedText>
        <ThemedText variant="caption" tone="secondary">{t('pageDesign.lapsedBody')}</ThemedText>
      </View>
      <PressableScale
        onPress={dismissLapsedAlert}
        accessibilityRole="button"
        accessibilityLabel={t('pageDesign.dismissAlert')}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText variant="titleMedium" tone="secondary">×</ThemedText>
      </PressableScale>
    </ThemedSurface>
  );
}

function lapsedEvidenceFor(
  record: ProfileRecord,
  nostrUploaded: boolean,
  publishedPageLabel: string
): readonly LapsedEvidence[] {
  const evidence: LapsedEvidence[] = [];
  const npubClaim = nostrUploaded
    ? record.alsoKnownAs.find((value) => value.startsWith('nostr:npub'))?.slice('nostr:'.length) ?? null
    : null;
  const nostr = readCachedNostrResult();
  const result = nostr?.result;
  if (npubClaim && result?.npub === npubClaim && result.state === 'stale') {
    evidence.push({ id: 'nostr', label: publishedPageLabel });
  }

  const handleClaim = record.alsoKnownAs.find((value) => value.startsWith('at://'))?.slice('at://'.length) ?? null;
  const atproto = readCachedAtprotoResult();
  if (
    handleClaim &&
    atproto?.result.evidence.handleClaim === handleClaim &&
    atproto.result.state === 'stale'
  ) {
    evidence.push({ id: 'bluesky', label: 'Bluesky' });
  }
  return evidence;
}
