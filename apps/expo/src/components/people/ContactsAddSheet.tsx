import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'expo-symbols';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export interface ContactsAddSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onScan: () => void;
  readonly onEnterManually: () => void;
  readonly onImportPhone: () => void;
  readonly onImportVcf: () => void;
  readonly onImportPage: () => void;
}

export function ContactsAddSheet({
  visible,
  onClose,
  onScan,
  onEnterManually,
  onImportPhone,
  onImportVcf,
  onImportPage,
}: ContactsAddSheetProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const choose = (action: () => void): void => {
    onClose();
    action();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: Colors.overlayBg }}>
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <ThemedSurface
          variant="elevated"
          style={{
            maxHeight: '82%',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View className="items-center gap-3 px-4 pb-4">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.divider }} />
            <ThemedText variant="titleMedium">{t('peopleList.add')}</ThemedText>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
            <ThemedSurface variant="card">
              <ContactsActionRow
                icon="qrcode.viewfinder"
                label={t('peopleList.scanTheirQr')}
                onPress={() => { choose(onScan); }}
              />
              <ContactsActionRow
                icon="square.and.pencil"
                label={t('peopleList.enterByHand')}
                onPress={() => { choose(onEnterManually); }}
                isLast
              />
            </ThemedSurface>

            <View style={{ height: 0.5, backgroundColor: Colors.divider }} />

            <ThemedSurface variant="inset">
              <ContactsActionRow
                icon="person.crop.circle.badge.plus"
                label={t('peopleList.importFromPhone')}
                onPress={() => { choose(onImportPhone); }}
                secondary
              />
              <ContactsActionRow
                icon="doc.badge.plus"
                label={t('peopleList.importVcfFile')}
                onPress={() => { choose(onImportVcf); }}
                secondary
              />
              <ContactsActionRow
                icon="link"
                label={t('peopleList.pasteLinkPage')}
                onPress={() => { choose(onImportPage); }}
                secondary
                isLast
              />
            </ThemedSurface>
          </ScrollView>

          <View className="px-4 pt-3">
            <ThemedButton
              fullWidth
              variant="secondary"
              label={t('peopleList.close')}
              onPress={onClose}
            />
          </View>
        </ThemedSurface>
      </View>
    </Modal>
  );
}

function ContactsActionRow({
  icon,
  label,
  onPress,
  secondary = false,
  isLast = false,
}: {
  readonly icon: SFSymbol;
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
  readonly isLast?: boolean;
}): ReactNode {
  const tint = secondary ? Colors.text2 : Colors.text1;

  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center px-4"
      style={{
        minHeight: 56,
        gap: 12,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: Colors.divider,
      }}
    >
      <View style={{ width: 24, alignItems: 'center' }}>
        <SfIcon name={icon} size={18} color={tint} />
      </View>
      <ThemedText
        variant={secondary ? 'bodyMedium' : 'bodyLarge'}
        tone={secondary ? 'secondary' : 'primary'}
        style={{ flex: 1 }}
      >
        {label}
      </ThemedText>
      <SfIcon name="chevron.right" size={12} color={Colors.text3} />
    </PressableScale>
  );
}
