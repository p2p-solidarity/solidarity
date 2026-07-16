/**
 * OnboardingScaffold — shared chrome for the SecureKeys / ImportContacts /
 * ScanPassport step bodies. Mirrors the repeated structure in Swift
 * OnboardingFlowView+Steps.swift (back-chevron in a square outline, title
 * 28pt bold, subtitle 14pt textSecondary, body slot, spacer, footer slot).
 *
 *   ┌──┐
 *   │ ‹│
 *   └──┘
 *
 *   Title
 *   Subtitle line 1
 *   Subtitle line 2
 *
 *   {children}
 *
 *   {footer}
 */
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export interface OnboardingScaffoldProps {
  readonly title: string;
  readonly subtitle: string;
  readonly onBack: () => void;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
}

export function OnboardingScaffold({
  title,
  subtitle,
  onBack,
  children,
  footer,
}: OnboardingScaffoldProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-pageBg">
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          flexGrow: 1,
          gap: 24,
        }}>
        <View style={{ flexDirection: 'row' }}>
          <PressableScale
            scaleTo={1}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.back')}
            style={{
              padding: 12,
              borderWidth: 1,
              borderColor: Colors.divider,
            }}>
            <SfIcon name="chevron.left" size={17} color={Colors.text1} />
          </PressableScale>
        </View>

        <View style={{ gap: 8 }}>
          <ThemedText variant="headlineMedium">{title}</ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {subtitle}
          </ThemedText>
        </View>

        <View style={{ flex: 1 }}>{children}</View>

        {footer ? <View>{footer}</View> : null}
      </ScrollView>
    </View>
  );
}
