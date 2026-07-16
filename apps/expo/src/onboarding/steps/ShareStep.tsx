/**
 * ShareStep — onboarding "分享" step (1.3.3 Task A2.5, converges onboarding
 * onto the Verified Page flow, US-01). After the new `connect` step, shows the
 * just-created Verified Page link + QR — reusing the exact fragment/QR
 * pipeline `ProfileSummaryCard` uses (`encodeFragment` + `generateQrPng`),
 * so the code scanned here is byte-identical to the one Me shows later.
 *
 * Honest states (CLAUDE.md rule 8 — no fake data):
 *   - `status === 'ready'` (a page was just created in `page`, or already
 *     existed — e.g. a REPLAY where the user has one) — a real link + real
 *     QR + Copy Link.
 *   - otherwise (the user skipped `page`) — a brief, generic pointer to Me,
 *     never a fabricated placeholder link/QR.
 */
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { generateQrPng } from '@/cards/qrCodeManager';
import { ThemedButton, ThemedText } from '@/components/themed';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useProfileStore } from '@/profile/store';
import { encodeFragment } from '@solidarity/shared';
import { OnboardingScaffold } from './OnboardingScaffold';

/** Mirrors `ProfileSummaryCard`'s canonical viewer URL — display text only;
 * the fragment never leaves the device (01-spec §1/§8). */
const FRAGMENT_BASE_URL = 'https://solidarity.gg/#';
const QR_SIZE = 220;

export interface ShareStepProps {
  readonly onBack: () => void;
  readonly onNext: () => void;
}

export function ShareStep({ onBack, onNext }: ShareStepProps) {
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const jws = useProfileStore((s) => s.jws);
  const status = useProfileStore((s) => s.status);

  const fragment = useMemo(() => (jws ? encodeFragment(jws) : null), [jws]);
  const fragmentUrl = fragment ? `${FRAGMENT_BASE_URL}${fragment.fragment}` : null;

  const [qrImageUri, setQrImageUri] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!fragmentUrl) {
      setQrImageUri(undefined);
      return;
    }
    let cancelled = false;
    void generateQrPng(fragmentUrl, { size: QR_SIZE }).then((uri) => {
      if (!cancelled) setQrImageUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [fragmentUrl]);

  const copyLink = async () => {
    if (!fragmentUrl) return;
    await Clipboard.setStringAsync(fragmentUrl);
    haptic('success');
    pushToast(t('shareStep.copied'), 'success');
  };

  if (status !== 'ready' || !record || !fragmentUrl) {
    return (
      <OnboardingScaffold
        onBack={onBack}
        title={t('shareStep.title')}
        subtitle={t('shareStep.noPageSubtitle')}
        footer={
          <ThemedButton
            label={t('onboarding.continue')}
            variant="inverted"
            fullWidth
            onPress={onNext}
          />
        }>
        <View style={{ flex: 1 }} />
        <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
          {t('shareStep.noPageHint')}
        </ThemedText>
        <View style={{ flex: 1 }} />
      </OnboardingScaffold>
    );
  }

  return (
    <OnboardingScaffold
      onBack={onBack}
      title={t('shareStep.title')}
      subtitle={t('shareStep.subtitle')}
      footer={
        <ThemedButton
          label={t('onboarding.continue')}
          variant="inverted"
          fullWidth
          onPress={onNext}
        />
      }>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <ThemedText variant="titleMedium">{record.displayName}</ThemedText>

        <View
          style={{
            width: QR_SIZE,
            height: QR_SIZE,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 2,
          }}>
          {qrImageUri ? (
            <Image
              source={{ uri: qrImageUri }}
              contentFit="contain"
              style={{ width: QR_SIZE - 16, height: QR_SIZE - 16 }}
            />
          ) : (
            <ThemedText variant="caption" tone="secondary">
              {t('profileCard.generatingQr')}
            </ThemedText>
          )}
        </View>

        <ThemedText
          variant="caption"
          tone="secondary"
          numberOfLines={1}
          style={{ maxWidth: '100%' }}>
          {fragmentUrl}
        </ThemedText>

        <ThemedButton
          label={t('shareStep.copyLink')}
          variant="secondary"
          fullWidth
          onPress={() => {
            void copyLink();
          }}
        />

        {fragment?.oversize ? (
          <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            {t('profileCard.oversizeWarning')}
          </ThemedText>
        ) : null}
      </View>
    </OnboardingScaffold>
  );
}
