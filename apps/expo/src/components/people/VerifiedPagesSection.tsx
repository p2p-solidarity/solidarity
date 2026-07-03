/**
 * VerifiedPagesSection — People tab entry point back to locally-saved
 * pages: Verified Pages (Task A2.3b, the fast-follow to A2.3/commit
 * 1afb4a2) AND declared link-page imports (Task A2.4, US-19). A2.3 shipped
 * `useProfileSnapshotStore` and the `/people/profile/[did]` detail screen
 * but nothing in People linked back to them after saving — this section
 * closes that gap, and A2.4 extends it to the unverified `kind: 'declared'`
 * branch of the same store.
 *
 * Renders nothing when there are no snapshots of either kind: the People
 * tab already owns its own contacts empty state (`EmptyState` in
 * `app/(tabs)/people/index.tsx`), so an empty section here would just be a
 * second, redundant "nothing here" message. The "貼上連結頁" import entry
 * point therefore lives in the tab's "+" menu (`Header` in
 * `app/(tabs)/people/index.tsx`), not here, so it's reachable even with
 * zero saved pages.
 *
 * Reads `useSortedProfileSnapshots()`, which is backed by the in-memory
 * zustand store hydrated synchronously at boot (`hydrateProfileSnapshots()`
 * in `app/_layout.tsx`) — no awaits on this render path. Ordering: verified
 * entries first, then declared (see the selector's own doc) — a
 * cryptographically-verified page always outranks an unverified claim.
 *
 * Row visual language borrows from `TrustGraphContactRow` (round initial
 * avatar, name + secondary line, bottom divider between rows) rather than
 * inventing a new row shape, per the fast-follow's "don't restructure the
 * existing contacts list" scope — this section sits above it instead. A
 * declared row additionally carries a visible 「宣稱‧未驗證」 chip
 * (CLAUDE.md rule 8 — never let an unverified claim look verified) and its
 * OWN route (`/people/declared/[id]`, not `/people/profile/[did]` — a
 * declared entry has no did to key that route on).
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
import {
  useSortedProfileSnapshots,
  type DeclaredSnapshot,
  type ProfileSnapshot,
  type VerifiedSnapshot,
} from '@/people/profileSnapshots';
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
          <SnapshotRow
            key={snapshot.kind === 'verified' ? snapshot.did : snapshot.id}
            snapshot={snapshot}
            isLast={index === snapshots.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function SnapshotRow({
  snapshot,
  isLast,
}: {
  readonly snapshot: ProfileSnapshot;
  readonly isLast: boolean;
}): ReactNode {
  return snapshot.kind === 'verified' ? (
    <VerifiedPageRow snapshot={snapshot} isLast={isLast} />
  ) : (
    <DeclaredPageRow snapshot={snapshot} isLast={isLast} />
  );
}

function VerifiedPageRow({
  snapshot,
  isLast,
}: {
  readonly snapshot: VerifiedSnapshot;
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
          {`${shortDid(snapshot.did)} · ${relativeAtLabel(snapshot.verifiedAt, t)}`}
        </ThemedText>
      </View>
      <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
    </PressableScale>
  );
}

function DeclaredPageRow({
  snapshot,
  isLast,
}: {
  readonly snapshot: DeclaredSnapshot;
  readonly isLast: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const displayTitle = snapshot.title && snapshot.title.trim().length > 0 ? snapshot.title : hostnameOf(snapshot.sourceUrl);

  return (
    <PressableScale
      haptic="tap"
      onPress={() => {
        router.push({ pathname: '/people/declared/[id]', params: { id: snapshot.id } });
      }}
      accessibilityRole="button"
      accessibilityLabel={displayTitle}
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
          {initial(displayTitle)}
        </ThemedText>
      </View>
      <View className="flex-1" style={{ gap: 2 }}>
        <ThemedText variant="bodyLarge" numberOfLines={1}>
          {displayTitle}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {`${hostnameOf(snapshot.sourceUrl)} · ${relativeAtLabel(snapshot.importedAt, t)}`}
        </ThemedText>
      </View>
      <View
        className="rounded-full border border-divider px-2 py-0.5"
        style={{ borderStyle: 'dashed' }}
      >
        <ThemedText variant="caption" tone="tertiary">
          {t('peopleList.declaredBadge')}
        </ThemedText>
      </View>
      <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
    </PressableScale>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function initial(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}

/** Shared by both row kinds — `verifiedAt` for a verified row, `importedAt`
 * for a declared row; the bucketing math is identical either way. */
function relativeAtLabel(
  at: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const { unit, count } = verifiedAtRelative(at);
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
