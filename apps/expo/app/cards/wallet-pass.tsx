/**
 * Wallet pass generation — 1:1 port of
 * solidarity/Views/CardViews/WalletPassGeneration/WalletPassGenerationView.swift.
 *
 * Sections (mirrors Swift VStack order):
 *   1. Header        : wallet.pass SF Symbol + title + subtitle
 *   2. PassPreview   : blue gradient pass mock with QR
 *   3. ImportString  : copyable solidarity://contact deep link
 *   4. Actions       : Generate Pass / Add to Wallet (stub) / Cancel
 *   5. Info          : "About Apple Wallet Passes" card
 *
 * Apple's PassKit has no RN equivalent. We instead:
 *   - Build the unsigned `pass.json` payload (passBundle.ts)
 *   - Persist it to a temp file
 *   - Hand it to expo-sharing so the user can email/airdrop it to a
 *     server that holds the signing certificate.
 *   - When tapped on iOS, the Wallet app on the receiving side prompts
 *     for installation just like a normal .pkpass.
 *
 * TODO(nitro-walletpass): write a Nitro module that zips + signs the
 * pass.json + assets locally, then invokes PassKit.addPasses directly.
 */
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore } from '@/cards/cardManager';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  PassInformationView,
  PassPreviewView,
  buildAndSignPkpass,
  filteredCardFor,
  generateImportString,
} from '@/components/walletpass';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import type { BusinessCard, SharingLevel } from '@solidarity/shared';

const SHARING_LEVELS: readonly SharingLevel[] = [
  'public',
  'professional',
  'personal',
];

function isSharingLevel(value: string | undefined): value is SharingLevel {
  if (value === undefined) return false;
  return (SHARING_LEVELS as readonly string[]).includes(value);
}

interface GenerationState {
  readonly kind: 'idle' | 'generating' | 'ready';
  readonly fileUri?: string;
}

export default function WalletPassScreen() {
  const insets = useSafeAreaInsets();
  const { id, level: levelParam } =
    useLocalSearchParams<{ id?: string; level?: string }>();

  const manifest = useCardStore((s) => s.manifest);
  const detailsById = useCardStore((s) => s.details);
  const loadDetail = useCardStore((s) => s.loadDetail);

  const sharingLevel: SharingLevel = isSharingLevel(levelParam)
    ? levelParam
    : 'professional';

  const targetId = id ?? manifest[0]?.id;

  useEffect(() => {
    if (targetId) void loadDetail(targetId);
  }, [targetId, loadDetail]);

  const targetCard: BusinessCard | undefined = targetId
    ? detailsById.get(targetId)
    : undefined;

  const filtered = useMemo(
    () => (targetCard ? filteredCardFor(targetCard, sharingLevel) : undefined),
    [sharingLevel, targetCard]
  );

  const importString = useMemo(
    () => (targetCard ? generateImportString(targetCard, sharingLevel) : ''),
    [sharingLevel, targetCard]
  );

  const [generation, setGeneration] = useState<GenerationState>({
    kind: 'idle',
  });

  const handleGenerate = useCallback(async () => {
    if (!targetCard) return;
    setGeneration({ kind: 'generating' });
    try {
      const { fileUri } = await buildAndSignPkpass(targetCard, sharingLevel);
      if (!fileUri) {
        throw new Error('Pass bundle generated without a file URI.');
      }
      setGeneration({ kind: 'ready', fileUri });
      haptic('success');
      pushToast('Signed pass generated', 'success');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to generate pass.';
      setGeneration({ kind: 'idle' });
      haptic('error');
      Alert.alert('Unable to Create Pass', msg);
    }
  }, [sharingLevel, targetCard]);

  const handleAddToWallet = useCallback(async () => {
    if (generation.kind !== 'ready' || !generation.fileUri) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          'Sharing unavailable',
          'Sharing is not available on this device.'
        );
        return;
      }
      // Hand the signed .pkpass off to expo-sharing — on iOS the system
      // share sheet recognises the MIME type and offers "Add to Wallet"
      // directly. Once a future Nitro module exposes PassKit's
      // `addPasses` API we can drop the share sheet entirely.
      await Sharing.shareAsync(generation.fileUri, {
        mimeType: 'application/vnd.apple.pkpass',
        UTI: 'com.apple.pkpass',
        dialogTitle: 'Add to Apple Wallet',
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Sharing failed.';
      Alert.alert('Unable to Add to Wallet', msg);
    }
  }, [generation]);

  const handleCopyImportString = useCallback(async () => {
    if (importString.length === 0) return;
    await Clipboard.setStringAsync(importString);
    haptic('selection');
    pushToast('Copied to clipboard', 'success');
  }, [importString]);

  if (!targetCard || !filtered) {
    return (
      <View
        className="flex-1 bg-pageBg"
        style={{ paddingTop: insets.top }}
      >
        <Header
          title="Wallet Pass"
          onDone={() => {
            router.back();
          }}
        />
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <ThemedText variant="titleMedium">No card available</ThemedText>
          <ThemedText
            variant="bodySmall"
            tone="secondary"
            style={{ paddingTop: 8, textAlign: 'center' }}
          >
            Create a business card before generating a wallet pass.
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top }}
    >
      <Header
        title="Wallet Pass"
        onDone={() => {
          router.back();
        }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingVertical: 16,
          paddingBottom: insets.bottom + 32,
          gap: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ alignItems: 'center', gap: 12, padding: 16 }}>
          <SfIcon name="wallet.pass" size={60} color={Colors.primaryBlue} />
          <ThemedText variant="headlineMedium">Apple Wallet Pass</ThemedText>
          <ThemedText
            variant="bodyMedium"
            tone="secondary"
            style={{ textAlign: 'center', paddingHorizontal: 20 }}
          >
            Create a pass for Apple Wallet that contains your business card
            information
          </ThemedText>
        </View>

        {/* Pass preview */}
        <PassPreviewView businessCard={filtered} qrPayload={importString} />

        {/* Generating spinner */}
        {generation.kind === 'generating' ? (
          <View style={{ alignSelf: 'stretch', gap: 12, alignItems: 'center', padding: 16 }}>
            <ThemedText variant="bodyMedium" tone="secondary">
              Generating pass...
            </ThemedText>
          </View>
        ) : null}

        {/* Import string */}
        {importString.length > 0 ? (
          <ImportStringSection
            value={importString}
            onCopy={() => {
              void handleCopyImportString();
            }}
          />
        ) : null}

        {/* Action buttons */}
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {generation.kind === 'ready' ? (
            <ThemedButton
              label="Add to Apple Wallet"
              variant="inverted"
              fullWidth
              leadingIcon={
                <SfIcon
                  name="plus.circle.fill"
                  size={16}
                  color={Colors.text1}
                />
              }
              onPress={() => {
                void handleAddToWallet();
              }}
            />
          ) : (
            <ThemedButton
              label="Generate Pass"
              variant="inverted"
              fullWidth
              loading={generation.kind === 'generating'}
              leadingIcon={
                <SfIcon
                  name="doc.badge.plus"
                  size={16}
                  color={Colors.text1}
                />
              }
              onPress={() => {
                void handleGenerate();
              }}
            />
          )}

          <Pressable
            onPress={() => {
              router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={{
              alignSelf: 'center',
              paddingVertical: 12,
              paddingHorizontal: 16,
            }}
          >
            <ThemedText variant="bodyMedium" tone="secondary">
              Cancel
            </ThemedText>
          </Pressable>
        </View>

        {/* Information section */}
        <PassInformationView />
      </ScrollView>
    </View>
  );
}

// MARK: - Import string section

interface ImportStringSectionProps {
  readonly value: string;
  readonly onCopy: () => void;
}

function ImportStringSection({
  value,
  onCopy,
}: ImportStringSectionProps) {
  return (
    <ThemedSurface
      variant="inset"
      padded
      style={{ marginHorizontal: 16, gap: 12 }}
    >
      <View style={{ gap: 4 }}>
        <ThemedText variant="titleMedium">Import String</ThemedText>
        <ThemedText variant="caption" tone="secondary">
          Deep link for importing contact data
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded>
        <ThemedText
          selectable
          variant="caption"
          numberOfLines={3}
          style={{ fontFamily: 'Menlo' }}
        >
          {value}
        </ThemedText>
      </ThemedSurface>

      <ThemedButton
        variant="inverted"
        label="Copy Import String"
        fullWidth
        leadingIcon={<SfIcon name="doc.on.doc" size={14} color={Colors.text1} />}
        onPress={onCopy}
      />
    </ThemedSurface>
  );
}

// MARK: - Header

interface HeaderProps {
  readonly title: string;
  readonly onDone: () => void;
}

function Header({ title, onDone }: HeaderProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        paddingHorizontal: 8,
      }}
    >
      <View style={{ width: 80 }} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <ThemedText variant="titleMedium" numberOfLines={1}>
          {title}
        </ThemedText>
      </View>
      <View style={{ minWidth: 80, alignItems: 'flex-end' }}>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Done"
          hitSlop={8}
          style={{ paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <ThemedText variant="titleMedium" tone="accent">
            Done
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

