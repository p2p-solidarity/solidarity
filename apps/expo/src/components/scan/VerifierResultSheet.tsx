/**
 * VerifierResultSheet — 1:1 port of
 * solidarity/Views/ScanViews/VerifierResultSheet.swift.
 *
 * Bottom slide-in `Modal` that renders the outcome of a verifier scan:
 * a SolidarityPlaceholderCard with title + reason, the list of detail
 * claims (one per line), and a Close button. The validity badge (green
 * check / red X) is colour-coded off `result.valid`.
 */
import type { ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { SolidarityPlaceholderCard } from '@/components/passport/SolidarityPlaceholderCard';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

export interface VerifierResult {
  readonly valid: boolean;
  readonly title: string;
  readonly reason: string;
  readonly issuerDid?: string;
  readonly details: readonly string[];
}

export interface VerifierResultSheetProps {
  readonly visible: boolean;
  readonly result: VerifierResult | null;
  readonly onClose: () => void;
}

export function VerifierResultSheet({
  visible,
  result,
  onClose,
}: VerifierResultSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      {result ? <SheetBody result={result} onClose={onClose} /> : null}
    </Modal>
  );
}

function SheetBody({
  result,
  onClose,
}: {
  readonly result: VerifierResult;
  readonly onClose: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const badgeColor = result.valid ? Colors.terminalGreen : Colors.destructive;
  return (
    <View
      style={{ flex: 1, backgroundColor: Colors.pageBg, paddingTop: insets.top }}
    >
      <View
        className="flex-row items-center justify-between"
        style={{ paddingHorizontal: 16, height: 44 }}
      >
        <View style={{ width: 60 }} />
        <ThemedText variant="titleMedium">Verifier</ThemedText>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <SolidarityPlaceholderCard
          screenID="VERIFY-1"
          title={result.title}
          subtitle={result.reason}
        />

        <View
          className="flex-row items-center"
          style={{ gap: 8, paddingHorizontal: 4 }}
        >
          <SfIcon
            name={result.valid ? 'checkmark.seal.fill' : 'xmark.seal.fill'}
            size={18}
            color={badgeColor}
          />
          <ThemedText
            variant="label"
            style={{ color: badgeColor }}
          >
            {result.valid ? 'Verification successful' : 'Verification failed'}
          </ThemedText>
        </View>

        {result.issuerDid ? (
          <View style={{ gap: 4, paddingHorizontal: 4 }}>
            <ThemedText variant="caption" tone="tertiary">
              ISSUER
            </ThemedText>
            <ThemedText
              variant="bodySmall"
              tone="secondary"
              style={{ fontFamily: 'Menlo' }}
              selectable
            >
              {result.issuerDid}
            </ThemedText>
          </View>
        ) : null}

        {result.details.length > 0 ? (
          <View style={{ gap: 6, paddingHorizontal: 4 }}>
            <ThemedText variant="caption" tone="tertiary">
              CLAIMS
            </ThemedText>
            {result.details.map((detail, idx) => (
              <ThemedText
                key={`${String(idx)}-${detail}`}
                variant="caption"
                tone="secondary"
              >
                {`• ${detail}`}
              </ThemedText>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 12,
          paddingTop: 12,
        }}
      >
        <ThemedButton fullWidth label="Close" onPress={onClose} />
      </View>
    </View>
  );
}
