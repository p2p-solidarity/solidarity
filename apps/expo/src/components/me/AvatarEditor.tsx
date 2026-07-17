import { Fragment, type ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

import { AvatarPickerSheet } from './AvatarPickerSheet';
import { ProfileAvatar } from './ProfileHero';
import type { AvatarEditorController } from './useAvatarEditor';

export function AvatarEditor({
  recordAvatar,
  displayName,
  controller,
}: {
  readonly recordAvatar: string | null;
  readonly displayName: string;
  readonly controller: AvatarEditorController;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Fragment>
      <View className="items-center gap-2">
        <PressableScale
          haptic="tap"
          onPress={controller.open}
          accessibilityRole="button"
          accessibilityLabel={t('meEdit.avatar.change')}
          style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
          <ProfileAvatar
            avatar={recordAvatar}
            localAvatar={controller.localAvatar}
            displayName={displayName}
          />
          <ThemedSurface
            variant="elevated"
            className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full">
            <SfIcon name="camera" size={14} color={Colors.text1} />
          </ThemedSurface>
        </PressableScale>
        <ThemedText variant="caption" tone="secondary">
          {t('meEdit.avatar.change')}
        </ThemedText>
      </View>

      <AvatarPickerSheet
        visible={controller.sheetOpen}
        phase={controller.phase}
        canUseBluesky={controller.canUseBluesky}
        canRemove={controller.canRemove}
        onClose={controller.close}
        onChooseLibrary={() => {
          void controller.chooseFromLibrary();
        }}
        onUseBluesky={() => {
          void controller.useBluesky();
        }}
        onRemove={() => {
          void controller.remove();
        }}
        onResetError={controller.resetError}
      />
    </Fragment>
  );
}
