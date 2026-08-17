/**
 * OCR business-card scanner — 1:1 port of
 * solidarity/Views/CardViews/OCRScanner/OCRScannerView.swift.
 *
 * Flow (mirrors Swift state machine):
 *   1. Language picker (default selection: English)
 *   2. Scanning options (Take Photo / Choose from Photos)
 *   3. Image preview + processing spinner
 *   4. Extracted data card + "Use Data" toolbar action
 *
 * The Swift implementation runs Apple Vision OCR locally. Vision-camera v4
 * doesn't ship a text-recognition frame processor in this monorepo, so
 * `recogniseText` returns an empty array; the screen still mounts every
 * section the Swift original does (visual parity is the priority — the
 * field extraction kicks in automatically once a Nitro OCR module lands).
 *
 * The caller hands us back to wherever they came from via:
 *   router.push({ pathname: '/cards/ocr',
 *                 params: { redirect: '/cards/edit?prefill=...' } })
 * For now we plug into router.replace('/cards/edit') with prefill query
 * params (name, title, company, email, phone) so the existing edit form
 * picks them up as defaults.
 */
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { appAlert, showError } from '@/feedback/appAlert';
import {
  ExtractedDataContent,
  LanguageSelectionContent,
  ProcessingSection,
  ScanningOptionsContent,
  extractBusinessCardFields,
  recogniseText,
  type ScanLanguage,
} from '@/components/ocr';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import type { BusinessCard } from '@solidarity/shared';

type ExtractionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'processing' }
  | {
      readonly kind: 'ready';
      readonly card: BusinessCard;
      readonly confidenceScores: Readonly<Record<string, number>>;
    };

export default function OcrScannerScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ redirect?: string }>();

  const [showingLanguagePicker, setShowingLanguagePicker] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<ScanLanguage>('en');
  const [capturedUri, setCapturedUri] = useState<string | undefined>(undefined);
  const [extraction, setExtraction] = useState<ExtractionState>({ kind: 'idle' });

  const handleProcess = useCallback(
    async (uri: string) => {
      setExtraction({ kind: 'processing' });
      try {
        const observations = await recogniseText(uri, [selectedLanguage]);
        const { card, confidenceScores } = extractBusinessCardFields(observations);
        if (observations.length === 0) {
          // Recogniser stub returned nothing — surface the placeholder card
          // (visual parity stays intact, user is informed via toast).
          pushToast(
            'OCR coming soon — paste fields manually for now.',
            'info',
            4000
          );
        }
        setExtraction({ kind: 'ready', card, confidenceScores });
        haptic('success');
      } catch (err: unknown) {
        setExtraction({ kind: 'idle' });
        haptic('error');
        showError({
          context: 'Scan Business Card › OCR',
          summary: t('ocr.extractFailed'),
          error: err,
        });
      }
    },
    [selectedLanguage, t]
  );

  const handleTakePhoto = useCallback(async () => {
    const cur = await ImagePicker.getCameraPermissionsAsync();
    let granted = cur.granted;
    if (!granted) {
      const req = await ImagePicker.requestCameraPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) {
      appAlert({
        title: t('ocr.cameraRequired.title'),
        message: t('ocr.cameraRequired.message'),
        buttons: [
          { label: t('alert.cancel'), style: 'cancel' },
          {
            label: t('common.openSettings'),
            style: 'default',
            onPress: () => { void Linking.openSettings(); },
          },
        ],
      });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.uri) return;
    setCapturedUri(asset.uri);
    setExtraction({ kind: 'idle' });
    void handleProcess(asset.uri);
  }, [handleProcess, t]);

  const handleChooseFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      appAlert({
        title: t('ocr.photoRequired.title'),
        message: t('ocr.photoRequired.message'),
        buttons: [
          { label: t('alert.cancel'), style: 'cancel' },
          {
            label: t('common.openSettings'),
            style: 'default',
            onPress: () => { void Linking.openSettings(); },
          },
        ],
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.uri) return;
    setCapturedUri(asset.uri);
    setExtraction({ kind: 'idle' });
    void handleProcess(asset.uri);
  }, [handleProcess, t]);

  const handleRetake = useCallback(() => {
    setCapturedUri(undefined);
    setExtraction({ kind: 'idle' });
    void handleTakePhoto();
  }, [handleTakePhoto]);

  const handleChooseDifferent = useCallback(() => {
    setCapturedUri(undefined);
    setExtraction({ kind: 'idle' });
    void handleChooseFromLibrary();
  }, [handleChooseFromLibrary]);

  const handleUseData = useCallback(() => {
    if (extraction.kind !== 'ready') return;
    const c = extraction.card;
    const search = buildPrefillSearch(c);
    const target = params.redirect ?? `/cards/edit?${search}`;
    haptic('success');
    pushToast('Card data extracted', 'success');
    router.replace(target);
  }, [extraction, params.redirect]);

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top }}
    >
      <Header
        title="Scan Business Card"
        onCancel={() => {
          safeBack();
        }}
        trailing={
          extraction.kind === 'ready' ? (
            <Pressable
              onPress={handleUseData}
              accessibilityRole="button"
              accessibilityLabel="Use Data"
              hitSlop={8}
              style={{ paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <ThemedText variant="titleMedium" tone="accent">
                Use Data
              </ThemedText>
            </Pressable>
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingVertical: 20,
          gap: 20,
          paddingBottom: 40,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {showingLanguagePicker ? (
          <LanguageSelectionContent
            selected={selectedLanguage}
            onSelect={setSelectedLanguage}
            onContinue={() => {
              setShowingLanguagePicker(false);
            }}
          />
        ) : capturedUri ? (
          <ImagePreviewSection
            uri={capturedUri}
            onRetake={handleRetake}
            onChooseDifferent={handleChooseDifferent}
          />
        ) : (
          <ScanningOptionsContent
            onTakePhoto={() => {
              void handleTakePhoto();
            }}
            onChooseFromLibrary={() => {
              void handleChooseFromLibrary();
            }}
          />
        )}

        {extraction.kind === 'processing' ? <ProcessingSection /> : null}
        {extraction.kind === 'ready' ? (
          <ExtractedDataContent
            card={extraction.card}
            confidenceScores={extraction.confidenceScores}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

// MARK: - Image Preview Section

interface ImagePreviewSectionProps {
  readonly uri: string;
  readonly onRetake: () => void;
  readonly onChooseDifferent: () => void;
}

function ImagePreviewSection({
  uri,
  onRetake,
  onChooseDifferent,
}: ImagePreviewSectionProps) {
  return (
    <View style={{ gap: 16, alignItems: 'center' }}>
      <ThemedSurface
        variant="outlined"
        style={{ alignSelf: 'stretch', overflow: 'hidden' }}
      >
        <Image
          source={{ uri }}
          style={{ width: '100%', height: 220 }}
          resizeMode="contain"
        />
      </ThemedSurface>

      <View style={{ flexDirection: 'row', gap: 16, alignSelf: 'stretch' }}>
        <View style={{ flex: 1 }}>
          <ThemedButton
            variant="inverted"
            label="Retake"
            fullWidth
            onPress={onRetake}
          />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedButton
            variant="inverted"
            label="Choose Different"
            fullWidth
            onPress={onChooseDifferent}
          />
        </View>
      </View>
    </View>
  );
}

// MARK: - Header (Swift NavigationStack toolbar parity)

interface HeaderProps {
  readonly title: string;
  readonly onCancel: () => void;
  readonly trailing?: React.ReactNode;
}

function Header({ title, onCancel, trailing }: HeaderProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        paddingHorizontal: 8,
      }}
    >
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        hitSlop={8}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 8,
        }}
      >
        <SfIcon
          name="chevron.left"
          size={16}
          weight="semibold"
          color={Colors.text1}
        />
        <ThemedText variant="bodyLarge">Cancel</ThemedText>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <ThemedText variant="titleMedium" numberOfLines={1}>
          {title}
        </ThemedText>
      </View>
      <View style={{ minWidth: 80, alignItems: 'flex-end' }}>{trailing}</View>
    </View>
  );
}

function buildPrefillSearch(card: BusinessCard): string {
  const parts: string[] = [];
  if (card.name.length > 0) parts.push(`name=${encodeURIComponent(card.name)}`);
  if (card.title) parts.push(`title=${encodeURIComponent(card.title)}`);
  if (card.company) parts.push(`company=${encodeURIComponent(card.company)}`);
  if (card.email) parts.push(`email=${encodeURIComponent(card.email)}`);
  if (card.phone) parts.push(`phone=${encodeURIComponent(card.phone)}`);
  return parts.join('&');
}
