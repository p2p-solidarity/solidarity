/**
 * VerifiedPageResultSheet — the scan-result sheet for a Verified Page QR
 * (1.3.3 Task A2.3, US-11). Reads `useVerifiedPageResult` directly (no
 * props needed) so it mounts once in `app/_layout.tsx` alongside
 * `ReceivedCardSheet` and reacts to a payload from EITHER the in-app
 * scanner (`app/scan/index.tsx`) or a universal/deep link handled while
 * the app is already elsewhere (`src/deeplink/router.ts`).
 *
 * Two honest states (CLAUDE.md rule 8 — never a partial render of
 * unverified data):
 *   - `verified` — `VerifiedProfileView` + a 「存入 People」 CTA. Saving a
 *     did that's already in `profileSnapshots` asks for confirmation
 *     first (re-scanning updates the snapshot, it doesn't silently
 *     duplicate it).
 *   - `invalid` — an honest 「無法驗證」 error card naming which step
 *     failed (decode / malformed payload / signature / schema). No retry
 *     of "maybe it's actually fine" — a failed verification is failed.
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useProfileSnapshot, useProfileSnapshotStore } from '@/people/profileSnapshots';
import { snapshotMergeToast } from '@/people/snapshotMergeCopy';
import { useVerifiedPageResult } from '@/scan/verifiedPageResult';
import type { VerifiedPageErrorReason } from '@/scan/verifiedPageHandler';

import { VerifiedProfileView } from './VerifiedProfileView';

export function VerifiedPageResultSheet(): ReactNode {
  const { t } = useTranslation();
  const result = useVerifiedPageResult((s) => s.result);
  const resolving = useVerifiedPageResult((s) => s.resolving);
  const dismiss = useVerifiedPageResult((s) => s.dismiss);
  const mergeVerified = useProfileSnapshotStore((s) => s.mergeVerified);
  const existing = useProfileSnapshot(result?.kind === 'verified' ? result.record.did : undefined);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  const onSave = async (): Promise<void> => {
    if (result?.kind !== 'verified' || saving) return;
    if (existing) {
      const ok = await confirmDialog({
        title: t('verifiedPage.duplicateTitle'),
        message: t('verifiedPage.duplicateMessage'),
        // Mirrors the CTA button's ternary below (review: keep both labels
        // in sync rather than hardcoding "Save" here while the button below
        // correctly reads "Update").
        confirmLabel: existing ? t('verifiedPage.updateInPeople') : t('verifiedPage.saveToPeople'),
      });
      if (!ok) return;
    }
    setSaving(true);
    const outcome = mergeVerified(result.record, result.jws);
    setSaving(false);
    const toast = snapshotMergeToast(outcome.kind);
    pushToast(t(toast.i18nKey), toast.tone);
    const did = result.record.did;
    dismiss();
    router.push({ pathname: '/people/profile/[did]', params: { did } });
  };

  return (
    <Modal
      visible={result !== null || resolving}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={dismiss}
    >
      {result ? (
        <View style={{ flex: 1, backgroundColor: Colors.pageBg, paddingTop: insets.top }}>
          <Toolbar title={t('verifiedPage.title')} onDone={dismiss} doneLabel={t('scan.close')} />

          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            {result.kind === 'verified' ? (
              <VerifiedProfileView
                record={result.record}
                handleBinding={result.handleBinding}
              />
            ) : (
              <InvalidCard reason={result.reason} />
            )}
          </ScrollView>

          {result.kind === 'verified' ? (
            <View
              style={{
                paddingHorizontal: 16,
                paddingBottom: insets.bottom + 12,
                paddingTop: 12,
              }}
            >
              <ThemedButton
                fullWidth
                loading={saving}
                label={existing ? t('verifiedPage.updateInPeople') : t('verifiedPage.saveToPeople')}
                leadingIcon={<SfIcon name="person.badge.plus" size={16} color={Colors.pageBg} />}
                onPress={() => {
                  void onSave();
                }}
              />
            </View>
          ) : null}
        </View>
      ) : resolving ? (
        <ResolvingView insets={insets} onDone={dismiss} title={t('verifiedPage.title')} label={t('verifiedPage.resolving')} closeLabel={t('scan.close')} />
      ) : null}
    </Modal>
  );
}

function ResolvingView({
  insets,
  onDone,
  title,
  label,
  closeLabel,
}: {
  readonly insets: EdgeInsets;
  readonly onDone: () => void;
  readonly title: string;
  readonly label: string;
  readonly closeLabel: string;
}): ReactNode {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.pageBg, paddingTop: insets.top }}>
      <Toolbar title={title} onDone={onDone} doneLabel={closeLabel} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator size="small" color={Colors.text2} />
        <ThemedText variant="bodyMedium" tone="secondary">
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

/** Raw Result diagnostics are test/caller data, not localized user-facing copy. */
function InvalidCard({ reason }: { readonly reason: VerifiedPageErrorReason }): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-3 rounded-xl border border-divider p-4">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <SfIcon name="xmark.seal.fill" size={18} color={Colors.destructive} />
        <ThemedText variant="titleMedium" style={{ color: Colors.destructive }}>
          {t('verifiedPage.invalidTitle')}
        </ThemedText>
      </View>
      <ThemedText variant="bodyMedium" tone="secondary">
        {t(`verifiedPage.reason.${reason}`)}
      </ThemedText>
    </View>
  );
}

function Toolbar({
  title,
  doneLabel,
  onDone,
}: {
  readonly title: string;
  readonly doneLabel: string;
  readonly onDone: () => void;
}): ReactNode {
  return (
    <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 16, height: 44 }}>
      <View style={{ width: 60 }} />
      <ThemedText variant="titleMedium">{title}</ThemedText>
      <PressableScale
        haptic="tap"
        onPress={onDone}
        accessibilityRole="button"
        style={{ width: 60, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}
      >
        <ThemedText variant="bodyMedium">{doneLabel}</ThemedText>
      </PressableScale>
    </View>
  );
}
