/**
 * Verifier-side challenge sheet for passport show presentations. Displays
 * the single-frame challenge QR (32-byte nonce + scope) the holder scans
 * before generating their fresh `openac_show` proof; the nonce stays in the
 * outstanding-challenge store (TTL 5 min) and is consumed when the proof QR
 * comes back through the scan pipeline.
 */
import type { ReactNode } from 'react';
import { Modal, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export interface PassportShowChallengeSheetProps {
  readonly visible: boolean;
  readonly challengeJson: string | null;
  readonly onClose: () => void;
}

export function PassportShowChallengeSheet({
  visible,
  challengeJson,
  onClose,
}: PassportShowChallengeSheetProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-pageBg items-center"
        style={{ paddingTop: insets.top + 32, paddingHorizontal: 24, gap: 24 }}
      >
        <ThemedText variant="titleMedium" style={{ fontWeight: '700' }}>
          {t('passportShow.challengeTitle')}
        </ThemedText>
        {challengeJson ? (
          <View
            style={{ backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12 }}
          >
            <QRCode
              value={challengeJson}
              size={260}
              backgroundColor="#FFFFFF"
              color="#000000"
            />
          </View>
        ) : null}
        <ThemedText
          variant="bodyMedium"
          style={{ color: Colors.text2, textAlign: 'center' }}
        >
          {t('passportShow.challengeHint')}
        </ThemedText>
        <View style={{ flex: 1 }} />
        <View
          style={{ alignSelf: 'stretch', paddingBottom: insets.bottom + 24 }}
        >
          <ThemedButton
            label={t('passportShow.challengeDone')}
            fullWidth
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}
