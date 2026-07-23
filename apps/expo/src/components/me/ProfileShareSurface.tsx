import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
} from 'react-native';
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

import { preferredVerifiedHandleShareUrl } from './handleShareVerification';
import {
  buildProfileShareModel,
  pickBestShareUrl,
  type ProfileShareUrlCandidate,
} from './meProfileModel';
import {
  PROFILE_SHARE_QR_SIZE,
  ProfileShareReadyContent,
  type ProfileShareQrState,
  type ReadyProfileShareModel,
} from './ProfileShareSheetContent';

const QR_SHEET_DURATION_MS = 240;

type ShareModelState =
  | { readonly kind: 'loading' }
  | ReadyProfileShareModel
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
  const { height: windowHeight } = useWindowDimensions();
  const [shareState, setShareState] = useState<ShareModelState>({ kind: 'loading' });
  const [shareRetryNonce, setShareRetryNonce] = useState(0);
  const [qrState, setQrState] = useState<ProfileShareQrState>({
    kind: 'loading',
    url: null,
  });
  const [qrRetryNonce, setQrRetryNonce] = useState(0);

  useEffect(() => {
    if (!visible) {
      setShareState({ kind: 'loading' });
      return;
    }

    setShareState({ kind: 'loading' });
    try {
      const model = buildProfileShareModel(record, jws);
      // This cache-only helper is the honesty boundary. It returns null for
      // declared, stale, revoked, or otherwise unverified handles and never
      // performs a live verification from the share sheet.
      const verifiedHandle = preferredVerifiedHandleShareUrl(record);
      const candidates: ProfileShareUrlCandidate[] = [];
      if (verifiedHandle) {
        candidates.push({
          kind: 'handle',
          url: verifiedHandle.url,
          isVerified: true,
        });
      }
      if (model.shortUrl) {
        candidates.push({ kind: 'short', url: model.shortUrl });
      }
      candidates.push({ kind: 'offline', url: model.offlineUrl });

      const selection = pickBestShareUrl(candidates);
      if (selection.kind === 'error') {
        setShareState({ kind: 'error' });
        return;
      }
      setShareState({
        kind: 'ready',
        model,
        candidates,
        selected: selection.candidate,
        verifiedHandle,
      });
    } catch {
      setShareState({ kind: 'error' });
    }
  }, [jws, record, shareRetryNonce, visible]);

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
                  onRetryQr={() => {
                    setQrState({ kind: 'loading', url: shareState.selected.url });
                    setQrRetryNonce((value) => value + 1);
                  }}
                />
              ) : shareState.kind === 'loading' ? (
                <View
                  className="items-center justify-center gap-3"
                  style={{ minHeight: PROFILE_SHARE_QR_SIZE }}>
                  <ActivityIndicator size="small" color={Colors.text3} />
                  <ThemedText variant="bodySmall" tone="tertiary">
                    {t('meShare.preparing')}
                  </ThemedText>
                </View>
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
                      setShareState({ kind: 'loading' });
                      setShareRetryNonce((value) => value + 1);
                    }}
                  />
                </ThemedSurface>
              )}

              <ShareFieldsRow onPress={onOpenShareSettings} />
            </ScrollView>
          </ThemedSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ShareFieldsRow({ onPress }: { readonly onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('mePage.shareFields')}>
      <ThemedSurface
        variant="inset"
        className="flex-row items-center gap-3 rounded-none px-3"
        style={{ minHeight: 44 }}>
        <SfIcon name="slider.horizontal.3" size={14} color={Colors.text2} />
        <ThemedText variant="bodySmall" tone="secondary" className="flex-1">
          {t('mePage.shareFields')}
        </ThemedText>
        <SfIcon name="chevron.right" size={12} color={Colors.text3} />
      </ThemedSurface>
    </PressableScale>
  );
}
