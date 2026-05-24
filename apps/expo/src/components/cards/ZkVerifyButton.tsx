/**
 * ZkVerifyButton — 1:1 port of
 * solidarity/Views/CardViews/ZKVerifyButton.swift.
 *
 * Three-state primary button:
 *   idle    → "Verify with ZK" (shield.checkered)
 *   loading → spinner + "Generating proof…" (disabled)
 *   success → "Verified" with checkmark.seal.fill
 *
 * Haptic policy: warning on tap (matches Swift's destructive-ish gate
 * for cryptographic work), success on a returned-true verification.
 * The caller owns the verify function — no mock here.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

type ZkState = 'idle' | 'loading' | 'success';

export interface ZkVerifyButtonProps {
  readonly onVerify: () => Promise<boolean>;
  readonly label?: string;
  readonly loadingLabel?: string;
  readonly successLabel?: string;
}

export function ZkVerifyButton({
  onVerify,
  label = 'Verify with ZK',
  loadingLabel = 'Generating proof…',
  successLabel = 'Verified',
}: ZkVerifyButtonProps): ReactNode {
  const [state, setState] = useState<ZkState>('idle');

  const handlePress = (): void => {
    if (state === 'loading') return;
    haptic('warning');
    setState('loading');
    void (async () => {
      try {
        const ok = await onVerify();
        if (ok) {
          haptic('success');
          setState('success');
        } else {
          setState('idle');
        }
      } catch {
        setState('idle');
      }
    })();
  };

  const isLoading = state === 'loading';
  const isSuccess = state === 'success';
  const currentLabel = isLoading
    ? loadingLabel
    : isSuccess
      ? successLabel
      : label;
  const iconName = isSuccess ? 'checkmark.seal.fill' : 'shield.checkered';

  return (
    <ThemedButton
      label={currentLabel}
      variant="primary"
      loading={isLoading}
      disabled={isLoading}
      haptic={false}
      onPress={handlePress}
      leadingIcon={
        isLoading ? null : (
          <SfIcon name={iconName} size={16} color={Colors.cardBg} />
        )
      }
    />
  );
}
