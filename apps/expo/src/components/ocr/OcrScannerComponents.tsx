/**
 * OcrScannerComponents — 1:1 port of
 * solidarity/Views/CardViews/OCRScanner/OCRScannerComponents.swift.
 *
 * Exposes the small leaf widgets used by the OCR scanner screen:
 *   - ExtractedFieldView : label + value + ConfidenceBadge trailing
 *   - ConfidenceBadge    : "75%" pill with traffic-light tone
 *   - LanguageOptionView : selectable row for the language picker
 *
 * The Swift screen also defined a `CameraView` UIViewControllerRepresentable
 * wrapping UIImagePickerController. On Expo we lean on `expo-image-picker`
 * directly from the screen (parity with apps/expo/app/cards/edit.tsx), so
 * the bridge component is not needed here.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

import type { ScanLanguage } from './scanLanguage';
import { scanLanguageDisplayName, scanLanguageFlag } from './scanLanguage';

/** Confidence values are normalised in [0, 1]. */
export interface ConfidenceBadgeProps {
  readonly confidence: number;
}

function confidenceTone(value: number): string {
  if (value >= 0.8) return Colors.terminalGreen;
  if (value >= 0.6) return Colors.accentRose;
  return Colors.destructive;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps): ReactNode {
  const tone = confidenceTone(confidence);
  const percent = Math.round(confidence * 100);
  return (
    <View
      style={{
        backgroundColor: `${tone}33`,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
      }}
    >
      <ThemedText variant="caption" style={{ color: tone }}>
        {`${String(percent)}%`}
      </ThemedText>
    </View>
  );
}

export interface ExtractedFieldViewProps {
  readonly label: string;
  readonly value: string;
  readonly confidence?: number;
}

export function ExtractedFieldView({
  label,
  value,
  confidence,
}: ExtractedFieldViewProps): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="caption" tone="secondary">
          {label}
        </ThemedText>
        <ThemedText variant="bodyMedium" tone="primary">
          {value}
        </ThemedText>
      </View>
      {confidence !== undefined ? (
        <ConfidenceBadge confidence={confidence} />
      ) : null}
    </View>
  );
}

export interface LanguageOptionViewProps {
  readonly language: ScanLanguage;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}

export function LanguageOptionView({
  language,
  isSelected,
  onPress,
}: LanguageOptionViewProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={scanLanguageDisplayName(language)}
      style={{ alignSelf: 'stretch' }}
    >
      <ThemedSurface
        variant={isSelected ? 'card' : 'outlined'}
        padded
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          ...(isSelected
            ? { borderColor: Colors.accentRose, borderWidth: 2 }
            : null),
        }}
      >
        <ThemedText variant="titleLarge">{scanLanguageFlag(language)}</ThemedText>
        <View style={{ flex: 1 }}>
          <ThemedText variant="titleMedium">
            {scanLanguageDisplayName(language)}
          </ThemedText>
        </View>
        {isSelected ? (
          <SfIcon
            name="checkmark.circle.fill"
            size={20}
            color={Colors.accentRose}
          />
        ) : null}
      </ThemedSurface>
    </Pressable>
  );
}
