import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Modal, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { CardMetalColors, Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import type { PhysicalCardMaterial } from '@/present/presentModel';
import { usePreferences } from '@/settings/preferences';

const MATERIALS = ['steel', 'blackTitanium', 'brass'] as const satisfies readonly PhysicalCardMaterial[];

export interface PhysicalCardSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function PhysicalCardSheet({
  visible,
  onClose,
}: PhysicalCardSheetProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const material = usePreferences(
    (state) => state.presentPhysicalCardMaterial ?? 'steel'
  );
  const engraveName = usePreferences(
    (state) => state.presentPhysicalCardEngraveName ?? true
  );
  const engraveUsername = usePreferences(
    (state) => state.presentPhysicalCardEngraveUsername ?? true
  );
  const engraveQr = usePreferences(
    (state) => state.presentPhysicalCardEngraveQr ?? true
  );
  const setPreference = usePreferences((state) => state.set);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 24,
            gap: 18,
          }}
        >
          <ThemedText accessibilityRole="header" variant="titleLarge">
            {t('present.physicalCard.title')}
          </ThemedText>

          <View style={{ gap: 10 }}>
            <ThemedText variant="label" tone="secondary">
              {t('present.physicalCard.material')}
            </ThemedText>
            <View className="flex-row" style={{ gap: 8 }}>
              {MATERIALS.map((option) => (
                <MaterialOption
                  key={option}
                  material={option}
                  label={t(`present.physicalCard.material.${option}`)}
                  selected={material === option}
                  onPress={() => {
                    setPreference('presentPhysicalCardMaterial', option);
                  }}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <ThemedText variant="label" tone="secondary">
              {t('present.physicalCard.engraving')}
            </ThemedText>
            <EngravingToggle
              label={t('present.physicalCard.engraveName')}
              value={engraveName}
              onValueChange={(value) => {
                setPreference('presentPhysicalCardEngraveName', value);
              }}
            />
            <EngravingToggle
              label={t('present.physicalCard.engraveUsername')}
              value={engraveUsername}
              onValueChange={(value) => {
                setPreference('presentPhysicalCardEngraveUsername', value);
              }}
            />
            <EngravingToggle
              label={t('present.physicalCard.engraveQr')}
              value={engraveQr}
              onValueChange={(value) => {
                setPreference('presentPhysicalCardEngraveQr', value);
              }}
            />
          </View>
        </ScrollView>

        <View
          className="bg-pageBg px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12), gap: 10 }}
        >
          <ThemedButton
            fullWidth
            disabled
            label={t('present.physicalCard.comingSoon')}
          />
          <ThemedButton
            fullWidth
            variant="secondary"
            label={t('present.close')}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

function MaterialOption({
  material,
  label,
  selected,
  onPress,
}: {
  readonly material: PhysicalCardMaterial;
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const colors = useThemeColors();
  return (
    <PressableScale
      fill
      haptic="tap"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
    >
      <ThemedSurface
        variant="outlined"
        className="items-center justify-center"
        style={{
          minHeight: 88,
          paddingHorizontal: 6,
          paddingVertical: 10,
          gap: 8,
          borderColor: selected ? colors.primaryBlue : colors.divider,
          borderWidth: selected ? 2 : 1,
        }}
      >
        <LinearGradient
          colors={materialGradient(material)}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ width: 34, height: 22, borderRadius: 5 }}
        />
        <View className="flex-row items-center" style={{ gap: 4 }}>
          {selected ? (
            <SfIcon
              name="checkmark.circle.fill"
              size={14}
              color={Colors.primaryBlue}
            />
          ) : null}
          <ThemedText variant="caption" numberOfLines={1}>
            {label}
          </ThemedText>
        </View>
      </ThemedSurface>
    </PressableScale>
  );
}

function EngravingToggle({
  label,
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}): ReactNode {
  const colors = useThemeColors();
  return (
    <ThemedSurface
      variant="inset"
      className="flex-row items-center px-4"
      style={{ minHeight: 52, gap: 12 }}
    >
      <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.divider, true: colors.primaryMauve }}
        thumbColor={colors.cardBg}
      />
    </ThemedSurface>
  );
}

function materialGradient(
  material: PhysicalCardMaterial
): readonly [string, string, string] {
  switch (material) {
    case 'steel':
      return [
        CardMetalColors.frontStops[0],
        CardMetalColors.frontStops[2],
        CardMetalColors.frontStops[7],
      ];
    case 'blackTitanium':
      return [Colors.pageNight, CardMetalColors.backStops[0], CardMetalColors.backStops[3]];
    case 'brass':
      return [Colors.warningText, Colors.cardDog, Colors.pageSunEnd];
  }
}
