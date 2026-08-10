import { type ReactNode } from 'react';
import { router } from 'expo-router';
import { Modal, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  PAGE_BACKGROUND_IDS,
  PAGE_FONT_IDS,
  PAGE_TEMPLATE_IDS,
  type PageBackgroundId,
  type PageTemplateId,
} from '@/page/pageDesign';
import { usePageDesignStore } from '@/page/pageDesignStore';
import type { ProfileRecord } from '@solidarity/shared';

import { PageLivePreview } from './PageLivePreview';

export interface PageAppearanceSheetProps {
  readonly visible: boolean;
  readonly record: ProfileRecord;
  readonly onClose: () => void;
}

const TEMPLATE_BACKGROUND: Readonly<Record<PageTemplateId, PageBackgroundId>> = {
  cream: 'cream',
  ink: 'ink',
  journal: 'cream',
  gradient: 'rose',
  night: 'ink',
  mint: 'mint',
  sun: 'cream',
  minimal: 'white',
};

export function PageAppearanceSheet({ visible, record, onClose }: PageAppearanceSheetProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const design = usePageDesignStore((state) => state.design);
  const setAppearance = usePageDesignStore((state) => state.setAppearance);
  const { appearance } = design;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 20 }}>
          <View className="flex-row items-center justify-between">
            <ThemedText variant="titleLarge">{t('pageDesign.appearance')}</ThemedText>
            <ThemedButton label={t('common.done')} variant="secondary" size="sm" onPress={onClose} />
          </View>

          <PageLivePreview record={record} blocks={design.blocks} appearance={appearance} />

          <ControlSection title={t('pageDesign.templates')}>
            <View className="flex-row flex-wrap gap-10">
              {PAGE_TEMPLATE_IDS.map((template) => (
                <ChoiceTile
                  key={template}
                  label={t(`pageDesign.template.${template}`)}
                  selected={appearance.template === template}
                  onPress={() => {
                    setAppearance({
                      template,
                      background: TEMPLATE_BACKGROUND[template],
                      customBackground: null,
                      ...(template === 'journal' ? { font: 'serif' as const } : {}),
                    });
                  }}
                />
              ))}
            </View>
          </ControlSection>

          <ControlSection title={t('pageDesign.font')}>
            <View className="flex-row flex-wrap gap-2">
              {PAGE_FONT_IDS.map((font, index) => (
                <ChoiceTile
                  key={font}
                  label={t(`pageDesign.font.${font}`)}
                  selected={appearance.font === font}
                  pro={index > 1}
                  onPress={() => {
                    if (index > 1) {
                      openProSettings();
                      return;
                    }
                    setAppearance({ font });
                  }}
                />
              ))}
            </View>
          </ControlSection>

          <ControlSection title={t('pageDesign.background')}>
            <View className="flex-row flex-wrap gap-2">
              {PAGE_BACKGROUND_IDS.map((background) => (
                <ChoiceTile
                  key={background}
                  label={t(`pageDesign.background.${background}`)}
                  selected={appearance.background === background && appearance.customBackground === null}
                  onPress={() => { setAppearance({ background, customBackground: null }); }}
                />
              ))}
            </View>
            <CustomColorInput
              appearance={appearance}
              onOpenPro={openProSettings}
            />
          </ControlSection>

          <ControlSection title={t('pageDesign.footer')}>
            <ThemedSurface padded className="gap-3">
              <View className="flex-row items-center justify-between">
                <ThemedText variant="bodyMedium">{t('pageDesign.showBrand')}</ThemedText>
                <Switch
                  value={appearance.showBrand}
                  onValueChange={openProSettings}
                  accessibilityHint={t('pageDesign.proControl')}
                  trackColor={{ true: Colors.primaryBlue }}
                />
              </View>
              <ProTextField
                label={t('pageDesign.footerText')}
                value={appearance.footerText}
                maxLength={40}
                hint={t('pageDesign.proControl')}
                onOpenPro={openProSettings}
              />
            </ThemedSurface>
          </ControlSection>
        </ScrollView>
      </View>
    </Modal>
  );
}

function CustomColorInput({
  appearance,
  onOpenPro,
}: {
  readonly appearance: ReturnType<typeof usePageDesignStore.getState>['design']['appearance'];
  readonly onOpenPro: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <ProTextField
      label={t('pageDesign.customColor')}
      value={appearance.customBackground ?? ''}
      placeholder={t('pageDesign.colorPlaceholder')}
      maxLength={7}
      hint={t('pageDesign.proControl')}
      onOpenPro={onOpenPro}
    />
  );
}

function ProTextField({
  label,
  value,
  placeholder,
  maxLength,
  hint,
  onOpenPro,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly hint: string;
  readonly onOpenPro: () => void;
}): ReactNode {
  return (
    <PressableScale
      onPress={onOpenPro}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      containerStyle={{ alignSelf: 'stretch' }}
      style={{ alignSelf: 'stretch' }}>
      <View pointerEvents="none">
        <ThemedTextInput
          label={label}
          value={value}
          onChangeText={() => {}}
          editable={false}
          placeholder={placeholder}
          maxLength={maxLength}
          hint={hint}
        />
      </View>
    </PressableScale>
  );
}

function openProSettings(): void {
  router.push('/settings/pro');
}

function ControlSection({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <View className="gap-3">
      <ThemedText accessibilityRole="header" variant="label" tone="tertiary">{title}</ThemedText>
      {children}
    </View>
  );
}

function ChoiceTile({
  label,
  selected,
  pro = false,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly pro?: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        minHeight: 44,
        minWidth: 88,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: selected ? Colors.primaryBlue : Colors.divider,
        backgroundColor: selected ? Colors.chipSurface : Colors.cardBg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <ThemedText variant="label">{label}{pro ? ' · PRO' : ''}</ThemedText>
    </PressableScale>
  );
}
