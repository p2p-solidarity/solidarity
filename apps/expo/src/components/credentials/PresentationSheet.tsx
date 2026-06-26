import { useMemo, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { PassportShowPresentation } from '@/components/credentials/PassportShowPresentation';
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
import { selectPassportShowPresentationClaims } from '@/passport/presentationClaims';

export interface PresentationSheetProps {
  readonly visible: boolean;
  readonly credential: PresentationCredential & { readonly title: string };
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
  /**
   * OpenAC-v3 passports with a vaulted show witness present a FRESH
   * `openac_show` proof (small animated QR) instead of replaying the
   * enrollment envelope. Decided by the caller (metadata tag + vault check).
   */
  readonly passportShowEligible?: boolean;
}

export function PresentationSheet({
  visible,
  credential,
  selectedClaimIds,
  onDismiss,
  passportShowEligible = false,
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
        passportShowEligible={passportShowEligible}
      />
    </Modal>
  );
}

function PresentationBody({
  credential,
  selectedClaimIds,
  onDismiss,
  passportShowEligible,
}: {
  readonly credential: PresentationCredential & { readonly title: string };
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
  readonly passportShowEligible: boolean;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const provableClaims = useIdentityData((s) => s.provableClaims);

  const selectedClaims: readonly ProvableClaimEntity[] = useMemo(
    () => {
      const claims = provableClaims.filter((c) => c.identityCardId === credential.id);
      return passportShowEligible
        ? selectPassportShowPresentationClaims(claims, selectedClaimIds)
        : selectPresentationClaims(claims, selectedClaimIds);
    },
    [provableClaims, credential.id, selectedClaimIds, passportShowEligible],
  );

  const pages = useMemo(
    () =>
      !passportShowEligible && selectedClaims.length > 0
        ? buildPresentationProofQrPages({ credential, selectedClaims })
        : [],
    [credential, selectedClaims, passportShowEligible],
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
        <PressableScale
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name="xmark" size={16} weight="semibold" color={Colors.text1} />
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: insets.bottom + 24,
          gap: 24,
        }}
      >
        {passportShowEligible ? (
          <PassportShowPresentation
            credentialId={credential.id}
            credentialTitle={credential.title}
            holderDid={credential.holderDid}
            selectedClaims={selectedClaims}
          />
        ) : (
          <PresentationProofQr
            credentialTitle={credential.title}
            selectedClaims={selectedClaims}
            pages={pages}
            showTitle
          />
        )}
      </ScrollView>
    </View>
  );
}
