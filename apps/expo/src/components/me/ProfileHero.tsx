import { getMmkv } from '@/storage/mmkv';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { resolveProfileAvatarSource } from '@/profile/avatar';
import { readLocalAvatarUri } from '@/profile/localAvatar';
import type { ProfileRecord } from '@solidarity/shared';

import { PageHeaderAction, PageHeaderActions } from './PageHeaderAction';
import { pageHeaderLayout } from './pageHeaderLayout';
import { ProfileShareSurface } from './ProfileShareSurface';
import { useProfileShareSelection } from './useProfileShareSelection';
import { displayProfileShareUrl, type PublicPageShareSource } from './meProfileModel';

/** `.me-ava` — the Page tab's own avatar size, distinct from the 92pt one
 *  the public page draws. */
export const ME_AVATAR_SIZE = 56;

export interface ProfileHeroProps {
  readonly record: ProfileRecord;
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly publicPage: PublicPageShareSource | null;
  readonly nostrShortUrlReady: boolean;
  readonly onEditAvatar: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenSettings: () => void;
}

export function ProfileHero({
  record,
  shareRecord,
  shareJws,
  publicPage,
  nostrShortUrlReady,
  onEditAvatar,
  onOpenAppearance,
  onOpenSettings,
}: ProfileHeroProps): ReactNode {
  const { t } = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const layout = pageHeaderLayout(width, fontScale);
  const [localAvatar, setLocalAvatar] = useState(readLocalAvatarUri);
  const shareSelection = useProfileShareSelection(
    shareRecord,
    shareJws,
    nostrShortUrlReady,
    0,
    publicPage,
  );
  const shareUrl = shareSelection.kind === 'ready' ? shareSelection.selected.url : null;
  const displayShareUrl = shareSelection.kind === 'ready'
    ? displayProfileShareUrl(shareSelection.selected)
    : null;

  useFocusEffect(
    useCallback(() => {
      setLocalAvatar(readLocalAvatarUri());
      const subscription = getMmkv().addOnValueChangedListener((key) => {
        if (key === 'profile:local-avatar:v1') setLocalAvatar(readLocalAvatarUri());
      });
      return () => { subscription.remove(); };
    }, [])
  );

  const copyShareUrl = useCallback(async (): Promise<void> => {
    if (shareUrl === null) return;
    try {
      await Clipboard.setStringAsync(shareUrl);
      haptic('success');
      pushToast(t('meHome.pageUrlCopied'), 'success');
    } catch {
      haptic('error');
      pushToast(t('meHome.pageUrlCopyFailed'), 'error');
    }
  }, [shareUrl, t]);

  return (
    <View className="gap-3 px-4">
      {/* `.me-top` — 56pt avatar, name, mono page address, and the three
          whole-page actions, all on one line (mock §`#s-page`). */}
      <View className="flex-row items-center" style={{ gap: 14, paddingTop: 4, paddingBottom: 4 }}>
        <PressableScale
          haptic="tap"
          onPress={onEditAvatar}
          accessibilityRole="button"
          accessibilityLabel={t('meHome.editPhoto')}
          style={{ width: ME_AVATAR_SIZE, height: ME_AVATAR_SIZE }}>
          <ProfileAvatar
            avatar={record.avatar}
            localAvatar={localAvatar}
            displayName={record.displayName}
          />
        </PressableScale>

        <View className="flex-1" style={{ gap: 1 }}>
          <ThemedText variant="headlineMedium" numberOfLines={1}>
            {record.displayName.length > 0 ? record.displayName : t('mePage.unnamed')}
          </ThemedText>

          {shareUrl !== null && displayShareUrl !== null ? (
            <PressableScale
              haptic={false}
              onPress={() => {
                void copyShareUrl();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('meHome.copyPageUrl', { url: displayShareUrl })}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              containerStyle={{ alignSelf: 'flex-start', maxWidth: '100%' }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <ThemedText
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ fontFamily: 'Menlo', flexShrink: 1 }}>
                {displayShareUrl}
              </ThemedText>
              <SfIcon name="doc.on.doc" size={11} color={Colors.text2} />
            </PressableScale>
          ) : null}
        </View>

        {layout === 'inline' ? (
          <ProfileHeaderActions
            shareRecord={shareRecord}
            shareJws={shareJws}
            publicPage={publicPage}
            nostrShortUrlReady={nostrShortUrlReady}
            appearanceLabel={t('mePage.appearance')}
            settingsLabel={t('mePage.settings')}
            onOpenAppearance={onOpenAppearance}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
      </View>

      {layout === 'stacked' ? (
        <View className="flex-row justify-end">
          <ProfileHeaderActions
            shareRecord={shareRecord}
            shareJws={shareJws}
            publicPage={publicPage}
            nostrShortUrlReady={nostrShortUrlReady}
            appearanceLabel={t('mePage.appearance')}
            settingsLabel={t('mePage.settings')}
            onOpenAppearance={onOpenAppearance}
            onOpenSettings={onOpenSettings}
          />
        </View>
      ) : null}
    </View>
  );
}

function ProfileHeaderActions({
  shareRecord,
  shareJws,
  publicPage,
  nostrShortUrlReady,
  appearanceLabel,
  settingsLabel,
  onOpenAppearance,
  onOpenSettings,
}: {
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly publicPage: PublicPageShareSource | null;
  readonly nostrShortUrlReady: boolean;
  readonly appearanceLabel: string;
  readonly settingsLabel: string;
  readonly onOpenAppearance: () => void;
  readonly onOpenSettings: () => void;
}): ReactNode {
  return (
    <PageHeaderActions>
      <ProfileShareSurface
        record={shareRecord}
        jws={shareJws}
        publicPage={publicPage}
        nostrShortUrlReady={nostrShortUrlReady}
      />
      <PageHeaderAction
        icon="circle.lefthalf.filled"
        label={appearanceLabel}
        onPress={onOpenAppearance}
      />
      <PageHeaderAction icon="gearshape" label={settingsLabel} onPress={onOpenSettings} />
    </PageHeaderActions>
  );
}

export function ProfileAvatar({
  avatar,
  localAvatar = null,
  displayName,
}: {
  readonly avatar: string | null;
  readonly localAvatar?: string | null;
  readonly displayName: string;
}): ReactNode {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = resolveProfileAvatarSource(avatar, localAvatar);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const initial = (displayName.trim().charAt(0) || '?').toUpperCase();
  return (
    <View
      className="overflow-hidden rounded-full bg-warmCream"
      style={{ width: ME_AVATAR_SIZE, height: ME_AVATAR_SIZE }}>
      <View className="absolute inset-0 items-center justify-center">
        <ThemedText variant="headlineMedium" style={{ color: Colors.primaryBlue }}>
          {initial}
        </ThemedText>
      </View>
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: ME_AVATAR_SIZE, height: ME_AVATAR_SIZE }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : null}
    </View>
  );
}
