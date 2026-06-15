/**
 * OcrScannerSections — 1:1 port of
 * solidarity/Views/CardViews/OCRScanner/OCRScannerView+Sections.swift.
 *
 * Exports the four section subviews the scanner screen composes:
 *   - LanguageSelectionContent : globe icon + language picker + Continue
 *   - ScanningOptionsContent   : viewfinder icon + Take Photo / Choose buttons
 *   - ExtractedDataContent     : confirmation card with extracted fields
 *   - ProcessingSection        : ActivityIndicator + status copy
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { BusinessCard } from '@solidarity/shared';

import { ExtractedFieldView, LanguageOptionView } from './OcrScannerComponents';
import {
  SCAN_LANGUAGES,
  type ScanLanguage,
} from './scanLanguage';

export interface LanguageSelectionContentProps {
  readonly selected: ScanLanguage;
  readonly onSelect: (next: ScanLanguage) => void;
  readonly onContinue: () => void;
}

export function LanguageSelectionContent({
  selected,
  onSelect,
  onContinue,
}: LanguageSelectionContentProps): ReactNode {
  return (
    <View style={{ gap: 28, alignItems: 'center' }}>
      <View style={{ paddingTop: 20 }}>
        <SfIcon name="globe" size={64} color={Colors.primaryBlue} />
      </View>

      <View style={{ gap: 8, alignItems: 'center' }}>
        <ThemedText variant="titleLarge">Select Language</ThemedText>
        <ThemedText
          variant="bodyMedium"
          tone="secondary"
          style={{ textAlign: 'center', paddingHorizontal: 24 }}
        >
          Choose the language of the business card you want to scan
        </ThemedText>
      </View>

      <View
        style={{
          alignSelf: 'stretch',
          gap: 14,
          paddingHorizontal: 24,
          paddingVertical: 8,
        }}
      >
        {SCAN_LANGUAGES.map((lang) => (
          <LanguageOptionView
            key={lang}
            language={lang}
            isSelected={lang === selected}
            onPress={() => {
              onSelect(lang);
            }}
          />
        ))}
      </View>

      <View
        style={{
          alignSelf: 'stretch',
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: 20,
        }}
      >
        <ThemedButton label="Continue" fullWidth onPress={onContinue} />
      </View>
    </View>
  );
}

export interface ScanningOptionsContentProps {
  readonly onTakePhoto: () => void;
  readonly onChooseFromLibrary: () => void;
}

export function ScanningOptionsContent({
  onTakePhoto,
  onChooseFromLibrary,
}: ScanningOptionsContentProps): ReactNode {
  return (
    <View style={{ gap: 24, alignItems: 'center' }}>
      <SfIcon
        name="doc.text.viewfinder"
        size={60}
        color={Colors.primaryBlue}
      />

      <ThemedText variant="titleLarge">Scan Business Card</ThemedText>

      <ThemedText
        variant="bodyMedium"
        tone="secondary"
        style={{ textAlign: 'center' }}
      >
        Use your camera to scan a business card or select an image from your
        photos
      </ThemedText>

      <View style={{ alignSelf: 'stretch', gap: 16 }}>
        <ThemedButton
          label="Take Photo"
          fullWidth
          leadingIcon={<SfIcon name="camera" size={16} color={Colors.cardBg} />}
          onPress={onTakePhoto}
        />
        <ThemedButton
          variant="inverted"
          label="Choose from Photos"
          fullWidth
          leadingIcon={<SfIcon name="photo" size={16} color={Colors.text1} />}
          onPress={onChooseFromLibrary}
        />
      </View>
    </View>
  );
}

export interface ExtractedDataContentProps {
  readonly card: BusinessCard;
  readonly confidenceScores: Readonly<Record<string, number>>;
}

export function ExtractedDataContent({
  card,
  confidenceScores,
}: ExtractedDataContentProps): ReactNode {
  return (
    <ThemedSurface
      variant="card"
      padded
      style={{
        alignSelf: 'stretch',
        borderColor: Colors.terminalGreen,
        borderWidth: 1,
        backgroundColor: `${Colors.terminalGreen}1A`,
      }}
    >
      <View style={{ gap: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <SfIcon
            name="checkmark.circle.fill"
            size={18}
            color={Colors.terminalGreen}
          />
          <ThemedText variant="titleMedium">Extraction Complete</ThemedText>
        </View>

        <View style={{ gap: 8 }}>
          {card.name.length > 0 ? (
            <ExtractedFieldView
              label="Name"
              value={card.name}
              confidence={confidenceScores['name']}
            />
          ) : null}
          {card.title && card.title.length > 0 ? (
            <ExtractedFieldView
              label="Title"
              value={card.title}
              confidence={confidenceScores['title']}
            />
          ) : null}
          {card.company && card.company.length > 0 ? (
            <ExtractedFieldView
              label="Company"
              value={card.company}
              confidence={confidenceScores['company']}
            />
          ) : null}
          {card.email && card.email.length > 0 ? (
            <ExtractedFieldView
              label="Email"
              value={card.email}
              confidence={confidenceScores['email']}
            />
          ) : null}
          {card.phone && card.phone.length > 0 ? (
            <ExtractedFieldView
              label="Phone"
              value={card.phone}
              confidence={confidenceScores['phone']}
            />
          ) : null}
        </View>

        <ThemedText variant="caption" tone="secondary" style={{ paddingTop: 8 }}>
          Review the extracted information and tap &apos;Use Data&apos; to apply
          it to your business card form.
        </ThemedText>
      </View>
    </ThemedSurface>
  );
}

export function ProcessingSection(): ReactNode {
  return (
    <ThemedSurface
      variant="inset"
      padded
      style={{ alignSelf: 'stretch', alignItems: 'center', gap: 16 }}
    >
      <ActivityIndicator size="large" color={Colors.accentRose} />
      <ThemedText variant="bodyMedium" tone="secondary">
        Processing image...
      </ThemedText>
      <ThemedText
        variant="caption"
        tone="secondary"
        style={{ textAlign: 'center' }}
      >
        Extracting text and identifying contact information
      </ThemedText>
    </ThemedSurface>
  );
}
