/**
 * VerifiedCard — Me tab's merged identity + QR expand card (1.3.3 Task A0.2).
 *
 * Combines the pre-1.3.3 Me-tab identity header (`ProfileHeaderCard`:
 * avatar/name/DID pill/Edit) with the pre-1.3.3 Share-tab QR expand card
 * (`QrShareCard`: collapsible own-QR + sharing field pills — it was already
 * "可展開" / expandable) into one "verified card" component, per
 * docs/ref/03-app-web-mechanisms.md §5:
 *   "新 Me = 現 Me 上半(identity 卡)+ 原 Share tab 底部 QR 展開卡,合併為
 *    一張可展開分享的已驗證名片"
 * Both pieces keep their Figma-matched visuals unmodified (reuse, no dup —
 * root CLAUDE.md rule 1); this component is the seam that used to be "two
 * separate tabs".
 *
 * A badge row sits between them. Phase A0.2 shipped it as an honest empty
 * state (no verification engine existed yet). 1.3.3 Task A4.4 wires the
 * FIRST real badge: `BadgeRow` now runs `verifyNostrBinding` (`@solidarity
 * /shared`) against `useProfileStore`'s record via the relay adapter
 * (`@/nostr/fetchKind0`) and renders whichever of the three honest states
 * (`verified`/`declared`/`stale`) the live check returns — see
 * `@/badges/nostrBadgeDisplay`'s module doc for the full honesty contract
 * (01-spec §7 / 03-spec §3: a one-way claim never renders a green check).
 * `npub === null` (profile makes no Nostr claim at all — connect it from
 * the Verify tab's "Connect Nostr" wizard, `app/verify/nostr.tsx`) keeps
 * the original honest empty state, unchanged.
 *
 * `ProfileSummaryCard` (1.3.3 Task A2.2) adds the new Profile Record
 * (01-spec §3) surface below the badge row — see that component's doc for
 * its three-state (needs-setup / empty / ready) contract and the
 * fragment-QR coexistence rule with the OLD `QrShareCard` exchange QR
 * below, which stays completely untouched.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { nostrBadgeViewModel, truncateNpub, type NostrBadgeVisual, type NostrBadgeViewModel } from '@/badges/nostrBadgeDisplay';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ProfileHeaderCard, type ProfileHeaderCardProps } from '@/components/me/ProfileHeaderCard';
import { ProfileSummaryCard } from '@/components/me/ProfileSummaryCard';
import { QrShareCard, type QrShareCardProps } from '@/components/share/QrShareCard';
import { Colors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { makeKind0Fetcher } from '@/nostr/fetchKind0';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { useProfileStore } from '@/profile/store';
import { verifyNostrBinding, type VerifyNostrBindingResult } from '@solidarity/shared';

type TFn = ReturnType<typeof useTranslation>['t'];

export type VerifiedCardProps = ProfileHeaderCardProps & QrShareCardProps;

export function VerifiedCard({
  name,
  did,
  avatar,
  onEdit,
  qrImageUri,
  cardName,
  enabledFields,
  hasRealHuman,
  onOpenSettings,
  onShare,
}: VerifiedCardProps) {
  return (
    <View className="gap-3">
      <ProfileHeaderCard name={name} did={did} avatar={avatar} onEdit={onEdit} />
      <BadgeRow />
      <ProfileSummaryCard />
      <View className="px-4">
        <QrShareCard
          qrImageUri={qrImageUri}
          cardName={cardName}
          enabledFields={enabledFields}
          hasRealHuman={hasRealHuman}
          onOpenSettings={onOpenSettings}
          onShare={onShare}
        />
      </View>
    </View>
  );
}

/**
 * Badge row — the first real badge (04-plan Phase A4 task A4.4). Reads the
 * saved Profile Record from `useProfileStore` and runs the SAME pure
 * `verifyNostrBinding` (`@solidarity/shared`) the future web viewer will
 * replay, via `@/nostr/fetchKind0`'s relay adapter over `DEFAULT_RELAYS`
 * (a read against public relay data needs no user confirmation — that gate
 * is specific to WRITING an event, see `publish.ts`'s `DEFAULT_RELAYS` doc).
 *
 * Loading is shown ONLY on the very first check (`hasResultRef`) — a
 * `useFocusEffect` re-run on tab refocus revalidates silently and swaps the
 * result in once it resolves, never flashing a skeleton over an
 * already-rendered badge (CLAUDE.md rule 10).
 */
function BadgeRow() {
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const [result, setResult] = useState<VerifyNostrBindingResult | null>(null);
  const [checking, setChecking] = useState(false);
  const hasResultRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!record) return;
      let cancelled = false;
      if (!hasResultRef.current) setChecking(true);
      void verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS)).then((r) => {
        if (cancelled) return;
        hasResultRef.current = true;
        setResult(r);
        setChecking(false);
      });
      return () => {
        cancelled = true;
      };
      // `record.updatedAt` (not just mount/focus) re-triggers the check —
      // publishing a fresh npub claim from the Connect Nostr wizard bumps it.
    }, [record?.updatedAt])
  );

  const vm = nostrBadgeViewModel(result, checking);

  if (vm.visual === 'hidden') {
    return (
      <View className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-3">
        <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="checkmark.seal" size={14} color={Colors.text3} />
        </View>
        <Text className="text-text3 text-[13px]">{t('verifiedCard.noBadgesYet')}</Text>
      </View>
    );
  }

  if (vm.visual === 'loading') {
    return (
      <View className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-3">
        <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={Colors.text3} />
        </View>
        <Text className="text-text3 text-[13px]">{t('badges.nostr.checking')}</Text>
      </View>
    );
  }

  const visualStyle = badgeVisualStyle(vm.visual);
  const label = badgeLabel(vm.visual, t);

  return (
    <PressableScale
      haptic="tap"
      onPress={() => {
        appAlert({ title: t('badges.nostr.evidenceTitle'), message: evidenceMessage(vm, t) });
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-3"
    >
      <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name={visualStyle.icon} size={14} color={visualStyle.color} />
      </View>
      <Text className="text-text2 text-[13px] flex-1" numberOfLines={1}>
        {label}
      </Text>
      <SfIcon name="chevron.right" size={11} color={Colors.text3} />
    </PressableScale>
  );
}

/** `verified`/`declared`/`stale` never share an icon+colour pairing — see `nostrBadgeDisplay.ts`'s honesty contract. */
function badgeVisualStyle(visual: NostrBadgeVisual): { readonly icon: 'checkmark.seal.fill' | 'checkmark.seal' | 'exclamationmark.triangle'; readonly color: string } {
  switch (visual) {
    case 'verified':
      return { icon: 'checkmark.seal.fill', color: Colors.terminalGreen };
    case 'stale':
      return { icon: 'exclamationmark.triangle', color: Colors.text3 };
    default:
      // 'declared' (and the unreachable 'hidden'/'loading' cases, guarded
      // out by the caller before this is invoked).
      return { icon: 'checkmark.seal', color: Colors.warning };
  }
}

function badgeLabel(visual: NostrBadgeVisual, t: TFn): string {
  switch (visual) {
    case 'verified':
      return t('badges.nostr.verifiedLabel');
    case 'stale':
      return t('badges.nostr.staleLabel');
    default:
      return t('badges.nostr.declaredLabel');
  }
}

/** Assembles the "one click to evidence" panel: state summary, both directions, npub, and the kind-0 timestamp when known. */
function evidenceMessage(vm: NostrBadgeViewModel, t: TFn): string {
  const lines: string[] = [];
  if (vm.visual === 'verified') lines.push(t('badges.nostr.evidence.verified'));
  else if (vm.visual === 'stale') lines.push(t('badges.nostr.evidence.stale'));
  else lines.push(t('badges.nostr.evidence.declared'));

  if (vm.npub) lines.push(t('badges.nostr.evidence.npubLine', { npub: truncateNpub(vm.npub) }));

  lines.push(vm.direction1 ? t('badges.nostr.evidence.direction1Held') : t('badges.nostr.evidence.direction1Missing'));
  lines.push(
    vm.direction2 === true
      ? t('badges.nostr.evidence.direction2Held')
      : vm.direction2 === false
        ? t('badges.nostr.evidence.direction2Missing')
        : t('badges.nostr.evidence.direction2Unknown')
  );

  if (vm.kind0CreatedAt !== null) {
    lines.push(
      t('badges.nostr.evidence.lastUpdatedLine', {
        date: new Date(vm.kind0CreatedAt * 1000).toLocaleString(),
      })
    );
  }

  return lines.join('\n');
}
