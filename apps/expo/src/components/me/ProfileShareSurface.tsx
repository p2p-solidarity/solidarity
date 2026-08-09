import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, ScrollView, Share, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { generateQrPng } from '@/cards/qrCodeManager';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { SCALE } from '@/feedback/motion';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import type { ProfileRecord } from '@solidarity/shared';

import {
  PROFILE_SHARE_QR_SIZE,
  ProfileShareReadyContent,
  type ProfileShareQrState,
  type ReadyProfileShareModel,
} from './ProfileShareSheetContent';
import { useProfileShareSelection } from './useProfileShareSelection';
import type { ProfileShareUrlCandidate } from './meProfileModel';
import { displayProfileShareUrl } from './meProfileModel';

const QR_SHEET_DURATION_MS = 240;

type ShareModelState = ReadyProfileShareModel | { readonly kind: 'error' };

export interface ProfileShareSurfaceProps {
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly nostrShortUrlReady: boolean;
}

export function ProfileShareSurface({
  record,
  jws,
  nostrShortUrlReady,
}: ProfileShareSurfaceProps): ReactNode {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <PressableScale
        haptic="tap"
        scaleTo={SCALE.icon}
        onPress={() => {
          setSheetOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('mePage.share')}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name="square.and.arrow.up" size={17} color={Colors.text1} />
      </PressableScale>

      <ProfileQrSheet
        visible={sheetOpen}
        record={record}
        jws={jws}
        nostrShortUrlReady={nostrShortUrlReady}
        onClose={() => {
          setSheetOpen(false);
        }}
      />
    </>
  );
}

const INLINE_QR_SIZE = 88;

/** Always-visible Page QR. The larger share sheet remains available for
 * format selection and exporting, while this preview makes the primary
 * scan action visible without another tap. */
export function ProfileInlineQr({
  record,
  jws,
  nostrShortUrlReady,
}: ProfileShareSurfaceProps): ReactNode {
  const { t } = useTranslation();
  const [inlineRetryNonce, setInlineRetryNonce] = useState(0);
  const shareState = useProfileShareSelection(
    record,
    jws,
    nostrShortUrlReady,
    inlineRetryNonce,
  );
  const selected = shareState.kind === 'ready' ? shareState.selected : null;
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (selected === null) {
      setImageUri(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setImageUri(null);
    void generateQrPng(selected.url, { size: INLINE_QR_SIZE })
      .then((uri) => {
        if (!cancelled) setImageUri(uri);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.url]);

  if (shareState.kind === 'error') {
    return (
      <ThemedSurface variant="outlined" className="items-center gap-3 rounded-2xl p-4">
        <SfIcon name="exclamationmark.triangle" size={22} color={Colors.destructive} />
        <ThemedText variant="bodySmall" tone="error" style={{ textAlign: 'center' }}>
          {t('meShare.modelError')}
        </ThemedText>
        <ThemedButton
          label={t('meShare.retry')}
          variant="secondary"
          onPress={() => {
            setInlineRetryNonce((value) => value + 1);
          }}
        />
      </ThemedSurface>
    );
  }
  if (selected === null) return null;
  const displayUrl = displayProfileShareUrl(selected);

  return (
    <PressableScale
      haptic="tap"
      onPress={() => {
        void Clipboard.setStringAsync(selected.url)
          .then(() => {
            haptic('success');
            pushToast(t('meHome.pageUrlCopied'), 'success');
          })
          .catch(() => {
            haptic('error');
            pushToast(t('meShare.copyError'), 'error');
          });
      }}
      accessibilityRole="button"
      accessibilityLabel={t('meHome.copyPageUrl', { url: displayUrl })}
      containerStyle={{ alignSelf: 'stretch' }}>
      <ThemedSurface
        variant="card"
        className="flex-row items-center gap-4 rounded-2xl p-3">
        <View
          style={{
            width: INLINE_QR_SIZE,
            height: INLINE_QR_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: Colors.cardBg,
            borderRadius: 12,
          }}>
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              contentFit="contain"
              style={{ width: INLINE_QR_SIZE - 8, height: INLINE_QR_SIZE - 8 }}
            />
          ) : failed ? (
            <SfIcon name="exclamationmark.triangle" size={20} color={Colors.destructive} />
          ) : (
            <ActivityIndicator color={Colors.primaryMauve} />
          )}
        </View>
        <View className="flex-1 gap-2">
          <ThemedText variant="label" numberOfLines={1}>
            {displayUrl}
          </ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {t('mePage.inlineQrHint')}
          </ThemedText>
          <View className="flex-row items-center gap-1">
            <SfIcon name="doc.on.doc" size={13} color={Colors.primaryMauve} />
            <ThemedText variant="caption" style={{ color: Colors.primaryMauve }}>
              {t('mePage.copyLink')}
            </ThemedText>
          </View>
        </View>
      </ThemedSurface>
    </PressableScale>
  );
}

function ProfileQrSheet({
  visible,
  record,
  jws,
  nostrShortUrlReady,
  onClose,
}: {
  readonly visible: boolean;
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly nostrShortUrlReady: boolean;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [shareRetryNonce, setShareRetryNonce] = useState(0);
  const [selectedKind, setSelectedKind] = useState<ProfileShareUrlCandidate['kind'] | null>(null);
  const [qrState, setQrState] = useState<ProfileShareQrState>({
    kind: 'loading',
    url: null,
  });
  const [qrRetryNonce, setQrRetryNonce] = useState(0);

  const baseShareState = useProfileShareSelection(record, jws, nostrShortUrlReady, shareRetryNonce);
  const shareState = useMemo<ShareModelState>(() => {
    if (baseShareState.kind === 'error') return baseShareState;
    const selected =
      baseShareState.candidates.find((candidate) => candidate.kind === selectedKind) ??
      baseShareState.selected;
    return { ...baseShareState, selected };
  }, [baseShareState, selectedKind]);

  useEffect(() => {
    if (!visible) setSelectedKind(null);
  }, [visible]);

  const activeUrl = shareState.kind === 'ready' ? shareState.selected.url : null;

  useEffect(() => {
    if (!visible || activeUrl === null) {
      setQrState({ kind: 'loading', url: activeUrl });
      return;
    }

    let cancelled = false;
    const url = activeUrl;
    setQrState({ kind: 'loading', url });
    void generateQrPng(url, { size: PROFILE_SHARE_QR_SIZE })
      .then((uri) => {
        if (!cancelled) setQrState({ kind: 'ready', url, uri });
      })
      .catch(() => {
        if (!cancelled) setQrState({ kind: 'error', url });
      });
    return () => {
      cancelled = true;
    };
  }, [activeUrl, qrRetryNonce, visible]);

  const copyUrl = async (url: string): Promise<void> => {
    try {
      await Clipboard.setStringAsync(url);
      haptic('success');
      pushToast(t('meShare.copied'), 'success');
    } catch {
      haptic('error');
      pushToast(t('meShare.copyError'), 'error');
    }
  };

  const shareUrl = async (url: string): Promise<void> => {
    try {
      await Share.share({
        title: t('meShare.title'),
        message: url,
        url,
      });
    } catch {
      haptic('error');
      pushToast(t('meShare.shareError'), 'error');
    }
  };

  const shareQrImage = async (uri: string): Promise<void> => {
    try {
      await Share.share({
        title: t('meShare.shareQrImage'),
        url: uri,
      });
    } catch {
      haptic('error');
      pushToast(t('meShare.shareError'), 'error');
    }
  };

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
            className="rounded-none px-4 pt-5"
            style={{ maxHeight: windowHeight - Math.max(insets.top, 12) }}>
            <View className="flex-row items-start gap-3">
              <ThemedText variant="titleLarge" className="flex-1 pt-2">
                {t('meShare.title')}
              </ThemedText>
              <PressableScale
                haptic="tap"
                scaleTo={SCALE.icon}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('meShare.close')}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <SfIcon name="xmark" size={16} color={Colors.text1} />
              </PressableScale>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{
                gap: 16,
                paddingTop: 12,
                paddingBottom: Math.max(insets.bottom, 16),
              }}
              showsVerticalScrollIndicator={false}
              alwaysBounceVertical={false}>
              {shareState.kind === 'ready' ? (
                <ProfileShareReadyContent
                  visible={visible}
                  state={shareState}
                  qrState={qrState}
                  onCopy={(url) => {
                    void copyUrl(url);
                  }}
                  onShare={(url) => {
                    void shareUrl(url);
                  }}
                  onShareQr={(uri) => {
                    void shareQrImage(uri);
                  }}
                  onSelectFormat={(candidate) => {
                    setSelectedKind(candidate.kind);
                  }}
                  onRetryQr={() => {
                    setQrState({ kind: 'loading', url: shareState.selected.url });
                    setQrRetryNonce((value) => value + 1);
                  }}
                />
              ) : (
                <ThemedSurface variant="inset" className="items-center gap-4 rounded-none p-4">
                  <SfIcon name="exclamationmark.triangle" size={24} color={Colors.destructive} />
                  <ThemedText variant="bodyMedium" tone="error" style={{ textAlign: 'center' }}>
                    {t('meShare.modelError')}
                  </ThemedText>
                  <ThemedButton
                    label={t('meShare.retry')}
                    variant="secondary"
                    onPress={() => {
                      setShareRetryNonce((value) => value + 1);
                    }}
                  />
                </ThemedSurface>
              )}
            </ScrollView>
          </ThemedSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}
