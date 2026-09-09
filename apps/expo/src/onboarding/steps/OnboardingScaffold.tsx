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
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { Easing, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { STAGGER_MS } from '@/feedback/motion';
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
  const entrance = (delay: number) =>
    FadeInDown.duration(240)
      .delay(delay)
      .easing(Easing.out(Easing.quad))
      .reduceMotion(ReduceMotion.System);

  return (
    <View className="flex-1 bg-pageBg">
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          flexGrow: 1,
          gap: 24,
        }}>
        <Animated.View
          key={`back-${title}`}
          entering={entrance(0)}
          style={{ flexDirection: 'row' }}>
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
        </Animated.View>

        <Animated.View
          key={`copy-${title}`}
          entering={entrance(STAGGER_MS)}
          style={{ gap: 8 }}>
          <ThemedText variant="headlineMedium">{title}</ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {subtitle}
          </ThemedText>
        </Animated.View>

        <Animated.View
          key={`content-${title}`}
          entering={entrance(STAGGER_MS * 2)}
          style={{ flex: 1 }}>
          {children}
        </Animated.View>

        {footer ? (
          <Animated.View key={`footer-${title}`} entering={entrance(STAGGER_MS * 3)}>
            {footer}
          </Animated.View>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
