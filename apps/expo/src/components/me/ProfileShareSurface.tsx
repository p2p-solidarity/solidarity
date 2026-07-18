import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import Animated, { Easing, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { generateQrPng } from '@/cards/qrCodeManager';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import type { ProfileRecord } from '@solidarity/shared';

import { preferredVerifiedHandleShareUrl } from './handleShareVerification';
import { buildProfileShareModel, selectProfileShareUrl } from './meProfileModel';

const QR_SIZE = 208;
const QR_SHEET_DURATION_MS = 240;

type QrState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly uri: string }
  | { readonly kind: 'error' };

export interface ProfileShareSurfaceProps {
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly onOpenShareSettings: () => void;
}

export function ProfileShareSurface({
  record,
  jws,
  onOpenShareSettings,
}: ProfileShareSurfaceProps): ReactNode {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <View className="gap-2 px-4">
      <ThemedButton
        label={t('mePage.shareYourPage')}
        variant="primary"
        fullWidth
        haptic="success"
        leadingIcon={<SfIcon name="qrcode" size={16} color={Colors.pageBg} />}
        onPress={() => {
          setSheetOpen(true);
        }}
      />
      <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
        {t('mePage.sharePromise')}
      </ThemedText>

      <ProfileQrSheet
        visible={sheetOpen}
        record={record}
        jws={jws}
        onOpenShareSettings={() => {
          setSheetOpen(false);
          onOpenShareSettings();
        }}
        onClose={() => {
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

function ProfileQrSheet({
  visible,
  record,
  jws,
  onOpenShareSettings,
  onClose,
}: {
  readonly visible: boolean;
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly onOpenShareSettings: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const model = useMemo(() => buildProfileShareModel(record, jws), [jws, record]);
  // Cache-only read (S8h pattern) — never a live re-verify, so this is safe
  // to recompute on every render the sheet opens.
  const handleCandidate = useMemo(() => preferredVerifiedHandleShareUrl(record), [record]);
  // Default selection is UNCHANGED by the handle option (§2.3 — the handle
  // link is offered, never defaulted to): 'short' when a Nostr pointer
  // exists, else 'offline', exactly as before this form existed.
  const [selectedUrl, setSelectedUrl] = useState<'handle' | 'short' | 'offline'>(
    model.shortUrl !== null ? 'short' : 'offline'
  );
  const usingHandle = selectedUrl === 'handle' && handleCandidate !== null;
  const usingShort = selectedUrl === 'short' && model.shortUrl !== null;
  const activeUrl = usingHandle
    ? handleCandidate.url
    : selectProfileShareUrl(model, usingShort);
  const [qrState, setQrState] = useState<QrState>({ kind: 'loading' });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setQrState({ kind: 'loading' });
    void generateQrPng(activeUrl, { size: QR_SIZE })
      .then((uri) => {
        if (!cancelled) setQrState({ kind: 'ready', uri });
      })
      .catch(() => {
        if (!cancelled) setQrState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [activeUrl, retryNonce, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: Colors.overlayBg,
        }}>
        <Animated.View
          entering={ZoomIn.duration(QR_SHEET_DURATION_MS)
            .easing(Easing.out(Easing.cubic))
            .withInitialValues({ opacity: 0, transform: [{ scale: 0.97 }] })}>
          <ThemedSurface
            variant="elevated"
            className="gap-4 rounded-none px-4 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
            <View className="flex-row items-start gap-3">
              <View className="flex-1 gap-1">
                <ThemedText variant="titleLarge">{t('mePage.shareSheetTitle')}</ThemedText>
                <ThemedText variant="bodySmall" tone="secondary">
                  {t('mePage.shareSheetSubtitle')}
                </ThemedText>
              </View>
              <PressableScale
                haptic="tap"
                scaleTo={SCALE.icon}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('mePage.closeShareSheet')}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <SfIcon name="xmark" size={16} color={Colors.text1} />
              </PressableScale>
            </View>

            {handleCandidate ? (
              <ThemedButton
                label={`@${handleCandidate.handle}`}
                variant={usingHandle ? 'primary' : 'secondary'}
                size="sm"
                fullWidth
                haptic="tap"
                leadingIcon={
                  <SfIcon
                    name="checkmark.seal.fill"
                    size={13}
                    color={usingHandle ? Colors.pageBg : Colors.terminalGreen}
                  />
                }
                onPress={() => {
                  setSelectedUrl('handle');
                }}
              />
            ) : null}

            {model.shortUrl ? (
              <View className="flex-row gap-2">
                <View style={{ flex: 1 }}>
                  <ThemedButton
                    label={t('profileCard.shortLink')}
                    variant={usingShort ? 'primary' : 'secondary'}
                    size="sm"
                    fullWidth
                    haptic="tap"
                    onPress={() => {
                      setSelectedUrl('short');
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedButton
                    label={t('profileCard.offlineLink')}
                    variant={selectedUrl === 'offline' ? 'primary' : 'secondary'}
                    size="sm"
                    fullWidth
                    haptic="tap"
                    onPress={() => {
                      setSelectedUrl('offline');
                    }}
                  />
                </View>
              </View>
            ) : null}

            <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {t(
                usingHandle
                  ? 'profileCard.handleLinkHint'
                  : usingShort
                    ? 'profileCard.shortLinkHint'
                    : 'profileCard.offlineLinkHint'
              )}
            </ThemedText>

            <ThemedSurface
              variant="card"
              className="self-center rounded-none p-2"
              style={{ width: QR_SIZE + 16, height: QR_SIZE + 16 }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                {qrState.kind === 'ready' ? (
                  <Image
                    source={{ uri: qrState.uri }}
                    contentFit="contain"
                    style={{ width: QR_SIZE, height: QR_SIZE }}
                  />
                ) : qrState.kind === 'loading' ? (
                  <View className="items-center gap-2">
                    <ActivityIndicator size="small" color={Colors.text3} />
                    <ThemedText variant="caption" tone="tertiary">
                      {t('profileCard.generatingQr')}
                    </ThemedText>
                  </View>
                ) : (
                  <View className="items-center gap-3 px-4">
                    <ThemedText variant="bodySmall" tone="error" style={{ textAlign: 'center' }}>
                      {t('mePage.qrError')}
                    </ThemedText>
                    <ThemedButton
                      label={t('mePage.retry')}
                      variant="secondary"
                      size="sm"
                      onPress={() => {
                        setQrState({ kind: 'loading' });
                        setRetryNonce((value) => value + 1);
                      }}
                    />
                  </View>
                )}
              </View>
            </ThemedSurface>

            {selectedUrl === 'offline' && model.oversize ? (
              <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
                {t('profileCard.oversizeWarning')}
              </ThemedText>
            ) : null}

            <PressableScale
              haptic="tap"
              onPress={onOpenShareSettings}
              accessibilityRole="button"
              accessibilityLabel={t('mePage.shareFields')}>
              <ThemedSurface
                variant="inset"
                className="flex-row items-center gap-3 rounded-none px-4 py-3">
                <SfIcon name="slider.horizontal.3" size={15} color={Colors.text2} />
                <View className="flex-1 gap-0.5">
                  <ThemedText variant="bodyMedium">{t('mePage.shareFields')}</ThemedText>
                  <ThemedText variant="caption" tone="tertiary">
                    {t('mePage.shareFieldsHint')}
                  </ThemedText>
                </View>
                <SfIcon name="chevron.right" size={12} color={Colors.text3} />
              </ThemedSurface>
            </PressableScale>
          </ThemedSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}
