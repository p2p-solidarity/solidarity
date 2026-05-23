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
import { Pressable, ScrollView, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

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
  return (
    <View className="bg-pageBg flex-1">
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 40,
          paddingBottom: 24,
          flexGrow: 1,
          gap: 24,
        }}
      >
        <View style={{ flexDirection: 'row' }}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={{
              padding: 12,
              borderWidth: 1,
              borderColor: Colors.divider,
            }}
          >
            <SfIcon name="chevron.left" size={17} color={Colors.text1} />
          </Pressable>
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
