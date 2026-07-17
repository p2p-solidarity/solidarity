import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import { resolveProfileAvatarSource } from '@/profile/avatar';
import { readLocalAvatarUri } from '@/profile/localAvatar';
import type { ProfileRecord } from '@solidarity/shared';

import { profileIdentityLine } from './meProfileModel';

export interface ProfileHeroProps {
  readonly record: ProfileRecord;
  readonly onEdit: () => void;
  readonly onOpenIdentity: () => void;
}

export function ProfileHero({ record, onEdit, onOpenIdentity }: ProfileHeroProps): ReactNode {
  const { t } = useTranslation();
  const identity = profileIdentityLine(record);
  const [localAvatar, setLocalAvatar] = useState(readLocalAvatarUri);

  useFocusEffect(
    useCallback(() => {
      setLocalAvatar(readLocalAvatarUri());
    }, [])
  );

  return (
    <View className="gap-4 px-4">
      <View className="flex-row items-start gap-4">
        <ProfileAvatar
          avatar={record.avatar}
          localAvatar={localAvatar}
          displayName={record.displayName}
        />

        <View className="flex-1 gap-2 pt-1">
          <ThemedText variant="headlineMedium" numberOfLines={2}>
            {record.displayName.length > 0 ? record.displayName : t('mePage.unnamed')}
          </ThemedText>
          <PressableScale
            haptic="tap"
            onPress={onOpenIdentity}
            accessibilityRole="button"
            accessibilityLabel={t('mePage.openIdentity')}
            containerStyle={{ alignSelf: 'flex-start' }}>
            <ThemedSurface
              variant="outlined"
              className="flex-row items-center gap-1 rounded-none px-2 py-1">
              <SfIcon
                name={identity.kind === 'handle' ? 'at' : 'checkmark.seal'}
                size={11}
                color={Colors.text2}
              />
              <ThemedText
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                ellipsizeMode="middle">
                {identity.kind === 'handle' ? identity.label : t('mePage.verifiedIdentity')}
              </ThemedText>
            </ThemedSurface>
          </PressableScale>
        </View>

        <PressableScale
          haptic="tap"
          scaleTo={SCALE.icon}
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t('profileCard.edit')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="pencil" size={17} color={Colors.text1} />
        </PressableScale>
      </View>

      {record.bio.length > 0 ? (
        <ThemedText variant="bodyMedium" tone="secondary">
          {record.bio}
        </ThemedText>
      ) : null}
    </View>
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
