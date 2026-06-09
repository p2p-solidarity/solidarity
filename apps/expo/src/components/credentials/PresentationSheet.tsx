import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PresentationProofQr } from '@/components/credentials/PresentationProofQr';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import { useIdentityData, type ProvableClaimEntity } from '@/identity';
import {
  buildPresentationProofQrPages,
  selectPresentationClaims,
  type PresentationCredential,
} from '@/credentials/presentationProof';

export interface PresentationSheetProps {
  readonly visible: boolean;
  readonly credential: PresentationCredential & { readonly title: string };
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
}

export function PresentationSheet({
  visible,
  credential,
  selectedClaimIds,
  onDismiss,
}: PresentationSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <PresentationBody
        credential={credential}
        selectedClaimIds={selectedClaimIds}
        onDismiss={onDismiss}
      />
    </Modal>
  );
}

function PresentationBody({
  credential,
  selectedClaimIds,
  onDismiss,
}: {
  readonly credential: PresentationCredential & { readonly title: string };
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const provableClaims = useIdentityData((s) => s.provableClaims);

  const selectedClaims: readonly ProvableClaimEntity[] = useMemo(
    () => selectPresentationClaims(
      provableClaims.filter((c) => c.identityCardId === credential.id),
      selectedClaimIds,
    ),
    [provableClaims, credential.id, selectedClaimIds],
  );

  const pages = useMemo(
    () =>
      selectedClaims.length > 0
        ? buildPresentationProofQrPages({ credential, selectedClaims })
        : [],
    [credential, selectedClaims],
  );

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View
        className="flex-row items-center justify-between px-4"
        style={{ height: 44 }}
      >
        <View style={{ width: 44 }} />
        <ThemedText variant="bodyMedium" style={{ fontWeight: '600' }}>
          Present
        </ThemedText>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          className="active:opacity-60"
        >
          <SfIcon name="xmark" size={16} weight="semibold" color={Colors.text1} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: insets.bottom + 24,
          gap: 24,
        }}
      >
        <PresentationProofQr
          credentialTitle={credential.title}
          selectedClaims={selectedClaims}
          pages={pages}
          showTitle
        />
      </ScrollView>
    </View>
  );
}
