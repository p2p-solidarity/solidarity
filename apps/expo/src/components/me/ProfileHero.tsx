import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { SCALE } from '@/feedback/motion';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { resolveProfileAvatarSource } from '@/profile/avatar';
import { readLocalAvatarUri } from '@/profile/localAvatar';
import type { ProfileRecord } from '@solidarity/shared';

import { pageHeaderLayout } from './pageHeaderLayout';
import { ProfileShareSurface } from './ProfileShareSurface';
import { ProfileInlineQr } from './ProfileShareSurface';
import { useProfileShareSelection } from './useProfileShareSelection';
import { displayProfileShareUrl } from './meProfileModel';

export interface ProfileHeroProps {
  readonly record: ProfileRecord;
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly nostrShortUrlReady: boolean;
  readonly onEditAvatar: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenSettings: () => void;
}

export function ProfileHero({
  record,
  shareRecord,
  shareJws,
  nostrShortUrlReady,
  onEditAvatar,
  onOpenAppearance,
  onOpenSettings,
}: ProfileHeroProps): ReactNode {
  const { t } = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const layout = pageHeaderLayout(width, fontScale);
  const [localAvatar, setLocalAvatar] = useState(readLocalAvatarUri);
  const shareSelection = useProfileShareSelection(shareRecord, shareJws, nostrShortUrlReady);
  const shareUrl = shareSelection.kind === 'ready' ? shareSelection.selected.url : null;
  const displayShareUrl = shareSelection.kind === 'ready'
    ? displayProfileShareUrl(shareSelection.selected)
    : null;

  useFocusEffect(
    useCallback(() => {
      setLocalAvatar(readLocalAvatarUri());
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
    <View className="gap-2 px-4">
      <View className="flex-row items-start gap-3">
        <PressableScale
          haptic="tap"
          onPress={onEditAvatar}
          accessibilityRole="button"
          accessibilityLabel={t('meHome.editPhoto')}
          style={{ width: 72, height: 72 }}>
          <ProfileAvatar
            avatar={record.avatar}
            localAvatar={localAvatar}
            displayName={record.displayName}
          />
          <ThemedSurface
            variant="elevated"
            className="absolute bottom-0 right-0 h-7 w-7 items-center justify-center rounded-full">
            <SfIcon name="camera" size={12} color={Colors.text1} />
          </ThemedSurface>
        </PressableScale>

        <View className="flex-1 gap-1 pt-1">
          <ThemedText variant="headlineMedium" numberOfLines={2}>
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
              containerStyle={{ alignSelf: 'stretch' }}
              style={{ minHeight: 44, justifyContent: 'center' }}>
              <ThemedSurface
                variant="card"
                className="flex-row items-center gap-2 rounded-none px-3 py-2">
                <ThemedText
                  variant="label"
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={{ flex: 1 }}>
                  {displayShareUrl}
                </ThemedText>
                <SfIcon name="doc.on.doc" size={14} color={Colors.primaryBlue} />
              </ThemedSurface>
            </PressableScale>
          ) : null}

          {record.bio.length > 0 ? (
            <ThemedText variant="bodyMedium" tone="secondary">
              {record.bio}
            </ThemedText>
          ) : null}
        </View>

        {layout === 'inline' ? (
          <ProfileHeaderActions
            shareRecord={shareRecord}
            shareJws={shareJws}
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
            nostrShortUrlReady={nostrShortUrlReady}
            appearanceLabel={t('mePage.appearance')}
            settingsLabel={t('mePage.settings')}
            onOpenAppearance={onOpenAppearance}
            onOpenSettings={onOpenSettings}
          />
        </View>
      ) : null}

      <ProfileInlineQr
        record={shareRecord}
        jws={shareJws}
        nostrShortUrlReady={nostrShortUrlReady}
      />
    </View>
  );
}

function ProfileHeaderActions({
  shareRecord,
  shareJws,
  nostrShortUrlReady,
  appearanceLabel,
  settingsLabel,
  onOpenAppearance,
  onOpenSettings,
}: {
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly nostrShortUrlReady: boolean;
  readonly appearanceLabel: string;
  readonly settingsLabel: string;
  readonly onOpenAppearance: () => void;
  readonly onOpenSettings: () => void;
}): ReactNode {
  return (
    <View className="flex-row">
      <ProfileShareSurface
        record={shareRecord}
        jws={shareJws}
        nostrShortUrlReady={nostrShortUrlReady}
      />
      <ProfileHeaderAction
        icon="paintbrush"
        label={appearanceLabel}
        onPress={onOpenAppearance}
      />
      <ProfileHeaderAction icon="gearshape" label={settingsLabel} onPress={onOpenSettings} />
    </View>
  );
}

function ProfileHeaderAction({
  icon,
  label,
  onPress,
}: {
  readonly icon: 'paintbrush' | 'gearshape';
  readonly label: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <PressableScale
      haptic="tap"
      scaleTo={SCALE.icon}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <SfIcon name={icon} size={17} color={Colors.text1} />
    </PressableScale>
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
      className="overflow-hidden rounded-full border border-divider bg-warmCream"
      style={{ width: 72, height: 72 }}>
      <View className="absolute inset-0 items-center justify-center">
        <ThemedText variant="headlineMedium" style={{ color: Colors.primaryBlue }}>
          {initial}
        </ThemedText>
      </View>
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: 72, height: 72 }}
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
