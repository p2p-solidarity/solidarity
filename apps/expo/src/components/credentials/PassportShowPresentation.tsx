/**
 * Holder UI for fresh `passport_show_v1` presentations. Rendered inside
 * `PresentationSheet` for OpenAC-v3 passport credentials with a vaulted
 * show witness; non-eligible credentials keep the legacy static QR path.
 *
 * Three real states only (CLAUDE.md Rule 8): proving shows a transient
 * progress message, ready shows the actual proof QR, error shows the real
 * failure with a retry — never a plausible placeholder.
 */
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';

import { PresentationProofQr } from '@/components/credentials/PresentationProofQr';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { ProvableClaimEntity } from '@/identity/entities';
import {
  clearPassportShowPrefetch,
  prefetchPassportShowPresentation,
} from '@/passport/showPrefetch';
import { usePassportShowPresentation } from '@/passport/useShowPresentation';
import { QrScanner } from '@/scan/QrScanner';

export interface PassportShowPresentationProps {
  readonly credentialId: string;
  readonly credentialTitle: string;
  readonly holderDid: string;
  readonly selectedClaims: readonly ProvableClaimEntity[];
  readonly showClaimDetails?: boolean;
}

export function PassportShowPresentation({
  credentialId,
  credentialTitle,
  holderDid,
  selectedClaims,
  showClaimDetails = true,
}: PassportShowPresentationProps): ReactNode {
  const { t } = useTranslation();
  // Start the witness decrypt + nitro lazy-load while the user is still
  // looking at the sheet — by prove time both are warm (spec §3).
  useEffect(() => {
    prefetchPassportShowPresentation(credentialId);
    return () => {
      clearPassportShowPrefetch(credentialId);
    };
  }, [credentialId]);
  const flow = usePassportShowPresentation({
    credentialId,
    holderDid,
    selectedClaims,
  });

  if (flow.state.phase === 'scanning-challenge') {
    return (
      <View style={{ gap: 16 }}>
        <ThemedText variant="bodyMedium" style={{ textAlign: 'center' }}>
          {t('passportShow.scanPrompt')}
        </ThemedText>
        <View style={{ height: 320, borderRadius: 16, overflow: 'hidden' }}>
          <QrScanner onResult={flow.onChallengeScanned} />
        </View>
        <ThemedButton
          label={t('passportShow.cancel')}
          variant="secondary"
          fullWidth
          onPress={flow.cancelChallengeScan}
        />
      </View>
    );
  }

  if (flow.state.phase === 'proving') {
    return (
      <View style={{ gap: 12, alignItems: 'center', paddingVertical: 32 }}>
        <ThemedText variant="bodyLarge" style={{ fontWeight: '600' }}>
          {flow.state.message}
        </ThemedText>
        <ThemedText
          variant="caption"
          style={{ color: Colors.text2, textAlign: 'center' }}
        >
          {t('passportShow.provingHint')}
        </ThemedText>
      </View>
    );
  }

  if (flow.state.phase === 'ready') {
    return (
      <View style={{ gap: 16 }}>
        <PresentationProofQr
          credentialTitle={credentialTitle}
          selectedClaims={selectedClaims}
          pages={flow.state.pages}
          showTitle
          showClaimDetails={showClaimDetails}
          footerText={
            flow.state.freshness === 'challenge'
              ? t('passportShow.footerChallenge')
              : t('passportShow.footerTimeBucket')
          }
        />
        <ThemedButton
          label={t('passportShow.presentAgain')}
          variant="secondary"
          fullWidth
          onPress={flow.reset}
        />
      </View>
    );
  }

  if (flow.state.phase === 'error') {
    return (
      <View style={{ gap: 16, paddingVertical: 16 }}>
        <ThemedText
          variant="bodyMedium"
          style={{ color: Colors.accentRose, textAlign: 'center' }}
        >
          {flow.state.message}
        </ThemedText>
        <ThemedButton
          label={t('passportShow.tryAgain')}
          fullWidth
          onPress={flow.reset}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <ThemedText
        variant="bodyMedium"
        style={{ color: Colors.text2, textAlign: 'center' }}
      >
        {t('passportShow.intro')}
      </ThemedText>
      <ThemedButton
        label={t('passportShow.scanChallenge')}
        fullWidth
        onPress={flow.beginChallengeScan}
      />
      <ThemedButton
        label={t('passportShow.presentWithout')}
        variant="secondary"
        fullWidth
        onPress={flow.presentTimeBucket}
      />
      <ThemedText
        variant="caption"
        style={{ color: Colors.text3, textAlign: 'center' }}
      >
        {t('passportShow.timeBucketHint')}
      </ThemedText>
    </View>
  );
}
