import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export type AvatarPickerPhase =
  | { readonly step: 'ready' }
  | { readonly step: 'loading'; readonly message: string }
  | { readonly step: 'error'; readonly message: string };

export interface AvatarPickerSheetProps {
  readonly visible: boolean;
  readonly phase: AvatarPickerPhase;
  readonly canUseBluesky: boolean;
  readonly canRemove: boolean;
  readonly onClose: () => void;
  readonly onChooseLibrary: () => void;
  readonly onUseBluesky: () => void;
  readonly onRemove: () => void;
  readonly onResetError: () => void;
}

export function AvatarPickerSheet({
  visible,
  phase,
  canUseBluesky,
  canRemove,
  onClose,
  onChooseLibrary,
  onUseBluesky,
  onRemove,
  onResetError,
}: AvatarPickerSheetProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const loading = phase.step === 'loading';
  const close = loading ? () => undefined : onClose;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}>
      {visible ? (
        <View
          className="flex-1 bg-pageBg"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 12 }}>
          <View className="min-h-14 flex-row items-center justify-between border-b border-divider px-4">
            <View style={{ width: 44 }} />
            <ThemedText variant="titleMedium">{t('meEdit.avatar.title')}</ThemedText>
            <PressableScale
              haptic="tap"
              disabled={loading}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={t('meEdit.avatar.close')}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <SfIcon name="xmark" size={16} color={loading ? Colors.text3 : Colors.text1} />
            </PressableScale>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            <ThemedText variant="bodyMedium" tone="secondary">
              {t('meEdit.avatar.subtitle')}
            </ThemedText>

            {phase.step === 'loading' ? (
              <ThemedSurface variant="outlined" padded>
                <View className="min-h-28 items-center justify-center gap-3">
                  <ActivityIndicator color={Colors.primaryBlue} />
                  <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
                    {phase.message}
                  </ThemedText>
                </View>
              </ThemedSurface>
            ) : null}

            {phase.step === 'error' ? (
              <ThemedSurface variant="outlined" padded>
                <View className="gap-3">
                  <View className="flex-row items-center gap-2">
                    <SfIcon name="exclamationmark.triangle" size={18} color={Colors.destructive} />
                    <ThemedText variant="titleMedium" style={{ color: Colors.destructive }}>
                      {t('meEdit.avatar.errorTitle')}
                    </ThemedText>
                  </View>
                  <ThemedText variant="bodyMedium" tone="secondary">
                    {phase.message}
                  </ThemedText>
                  <ThemedButton
                    label={t('meEdit.avatar.chooseAnother')}
                    variant="secondary"
                    fullWidth
                    onPress={onResetError}
                  />
                </View>
              </ThemedSurface>
            ) : null}

            {phase.step === 'ready' ? (
              <View className="gap-2">
                <AvatarActionRow
                  icon="photo"
                  label={t('meEdit.avatar.library')}
                  onPress={onChooseLibrary}
                />
                {canUseBluesky ? (
                  <AvatarActionRow
                    icon="person.crop.circle"
                    label={t('meEdit.avatar.bluesky')}
                    detail={t('meEdit.avatar.blueskyHint')}
                    onPress={onUseBluesky}
                  />
                ) : null}
                <AvatarActionRow
                  icon="trash"
                  label={t('meEdit.avatar.remove')}
                  destructive
                  disabled={!canRemove}
                  onPress={onRemove}
                />
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

function AvatarActionRow({
  icon,
  label,
  detail,
  destructive = false,
  disabled = false,
  onPress,
}: {
  readonly icon: 'photo' | 'person.crop.circle' | 'trash';
  readonly label: string;
  readonly detail?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const color = disabled ? Colors.text3 : destructive ? Colors.destructive : Colors.text1;
  return (
    <PressableScale
      haptic={destructive ? 'warning' : 'tap'}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-14 flex-row items-center gap-3 border border-divider bg-cardBg px-4 py-3">
      <View className="w-7 items-center">
        <SfIcon name={icon} size={18} color={color} />
      </View>
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodyMedium" style={{ color }}>
          {label}
        </ThemedText>
        {detail ? (
          <ThemedText variant="caption" tone="secondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {!disabled ? <SfIcon name="chevron.right" size={13} color={Colors.text3} /> : null}
    </PressableScale>
  );
}
