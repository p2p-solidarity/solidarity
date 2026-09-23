import * as Clipboard from 'expo-clipboard';
import type { ReactNode } from 'react';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';

interface CopyableAddressProps {
  /** Preserve the existing Page hero layout; standalone controls get 44pt. */
  readonly compact?: boolean;
  readonly address: string;
  readonly displayAddress: string;
  readonly accessibilityLabel: string;
  readonly copiedMessage: string;
  readonly failedMessage: string;
}

/** The Page hero's compact address control, including its existing feedback. */
export function CopyableAddress({
  compact = false,
  address,
  displayAddress,
  accessibilityLabel,
  copiedMessage,
  failedMessage,
}: CopyableAddressProps): ReactNode {
  const copy = async (): Promise<void> => {
    try {
      await Clipboard.setStringAsync(address);
      haptic('success');
      pushToast(copiedMessage, 'success');
    } catch {
      haptic('error');
      pushToast(failedMessage, 'error');
    }
  };

  return (
    <PressableScale
      haptic={false}
      onPress={() => { void copy(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      containerStyle={{ alignSelf: 'flex-start', maxWidth: '100%' }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: compact ? undefined : 44 }}>
      <ThemedText
        variant="caption"
        tone="secondary"
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{ fontFamily: 'Menlo', flexShrink: 1 }}>
        {displayAddress}
      </ThemedText>
      <SfIcon name="doc.on.doc" size={11} color={Colors.text2} />
    </PressableScale>
  );
}
