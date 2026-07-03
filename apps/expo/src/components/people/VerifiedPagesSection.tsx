/**
 * VerifiedPagesSection — People tab entry point back to locally-saved
 * Verified Page snapshots (Task A2.3b, the fast-follow to A2.3/commit
 * 1afb4a2). A2.3 shipped `useProfileSnapshotStore` and the
 * `/people/profile/[did]` detail screen but nothing in People linked back
 * to them after saving — this section closes that gap.
 *
 * Renders nothing when there are no snapshots: the People tab already owns
 * its own contacts empty state (`EmptyState` in
 * `app/(tabs)/people/index.tsx`), so an empty Verified Pages block here
 * would just be a second, redundant "nothing here" message.
 *
 * Reads `useSortedProfileSnapshots()`, which is backed by the in-memory
 * zustand store hydrated synchronously at boot (`hydrateProfileSnapshots()`
 * in `app/_layout.tsx`) — no awaits on this render path.
 *
 * Row visual language borrows from `TrustGraphContactRow` (round initial
 * avatar, name + secondary line, bottom divider between rows) rather than
 * inventing a new row shape, per the fast-follow's "don't restructure the
 * existing contacts list" scope — this section sits above it instead.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { shortDid } from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { useSortedProfileSnapshots, type ProfileSnapshot } from '@/people/profileSnapshots';
import { verifiedAtRelative } from '@/people/relativeVerifiedAt';

export function VerifiedPagesSection(): ReactNode {
  const { t } = useTranslation();
  const snapshots = useSortedProfileSnapshots();

  if (snapshots.length === 0) return null;

  return (
    <View className="px-4 pb-3" style={{ gap: 6 }}>
      <ThemedText variant="label" tone="secondary">
        {t('peopleList.verifiedPagesHeader')}
      </ThemedText>
      <View>
        {snapshots.map((snapshot, index) => (
          <VerifiedPageRow
            key={snapshot.did}
            snapshot={snapshot}
            isLast={index === snapshots.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function VerifiedPageRow({
  snapshot,
  isLast,
}: {
  readonly snapshot: ProfileSnapshot;
  readonly isLast: boolean;
}): ReactNode {
  const { t } = useTranslation();

  return (
    <PressableScale
      haptic="tap"
      onPress={() => {
        router.push({ pathname: '/people/profile/[did]', params: { did: snapshot.did } });
      }}
      accessibilityRole="button"
      accessibilityLabel={snapshot.record.displayName}
      className="flex-row items-center gap-3 py-3"
      style={{
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: Colors.divider,
      }}
    >
      <View
        className="items-center justify-center overflow-hidden rounded-full bg-searchBg"
        style={{ width: 38, height: 38 }}
      >
        <ThemedText variant="bodyMedium" tone="secondary">
          {initial(snapshot.record.displayName)}
        </ThemedText>
      </View>
      <View className="flex-1" style={{ gap: 2 }}>
        <ThemedText variant="bodyLarge" numberOfLines={1}>
          {snapshot.record.displayName}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {`${shortDid(snapshot.did)} · ${relativeVerifiedAtLabel(snapshot.verifiedAt, t)}`}
        </ThemedText>
      </View>
      <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
    </PressableScale>
  );
}

function initial(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}

function relativeVerifiedAtLabel(
  verifiedAt: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const { unit, count } = verifiedAtRelative(verifiedAt);
  switch (unit) {
    case 'justNow':
      return t('peopleList.verifiedPageJustNow');
    case 'minutes':
      return t('peopleList.verifiedPageMinutesAgo', { count });
    case 'hours':
      return t('peopleList.verifiedPageHoursAgo', { count });
    case 'days':
      return t('peopleList.verifiedPageDaysAgo', { count });
  }
}
