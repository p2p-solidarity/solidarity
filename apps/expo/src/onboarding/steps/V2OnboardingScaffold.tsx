import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { ONBOARDING_STEP_COUNT } from '@/onboarding/state';

export function V2OnboardingScaffold({
  stepIndex,
  title,
  subtitle,
  onBack,
  children,
  footer,
}: {
  readonly stepIndex: number;
  readonly title?: string;
  readonly subtitle?: string;
  readonly onBack?: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-pageBg">
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: ONBOARDING_STEP_COUNT, now: stepIndex + 1 }}
        className="flex-row items-center justify-center gap-2"
        style={{ paddingTop: insets.top + 12, minHeight: insets.top + 36 }}>
        {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, index) => (
          <View
            key={index}
            style={{
              width: index === stepIndex ? 20 : 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: index <= stepIndex ? Colors.primaryMauve : Colors.divider,
            }}
          />
        ))}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 24,
        }}>
        {onBack ? (
          <PressableScale
            haptic="tap"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.back')}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <SfIcon name="chevron.left" size={18} color={Colors.text1} />
          </PressableScale>
        ) : (
          <View style={{ height: 44 }} />
        )}

        <Animated.View
          entering={FadeIn.duration(220)
            .easing(Easing.out(Easing.cubic))
            .reduceMotion(ReduceMotion.System)}
          style={{ flex: 1, gap: 24 }}>
          {title || subtitle ? (
            <View style={{ gap: 8 }}>
              {title ? <ThemedText variant="headlineLarge">{title}</ThemedText> : null}
              {subtitle ? (
                <ThemedText variant="bodyLarge" tone="secondary">
                  {subtitle}
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <View style={{ flex: 1 }}>{children}</View>
          {footer ? <View>{footer}</View> : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
