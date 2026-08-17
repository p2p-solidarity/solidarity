import type { ReactNode } from 'react';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

import { V2OnboardingScaffold } from './V2OnboardingScaffold';

export function WelcomeStep({
  onStart,
  onExistingAccount,
}: {
  readonly onStart: () => void;
  readonly onExistingAccount: () => void;
}): ReactNode {
  const { t } = useTranslation();

  return (
    <V2OnboardingScaffold
      stepIndex={0}
      title={t('ob.welcome.title')}
      subtitle={t('ob.welcome.sub')}
      footer={
        <View style={{ gap: 10 }}>
          <ThemedButton
            label={t('ob.welcome.start')}
            variant="primary"
            fullWidth
            onPress={onStart}
          />
          <ThemedButton
            label={t('ob.welcome.has_account')}
            variant="secondary"
            fullWidth
            onPress={onExistingAccount}
          />
        </View>
      }>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedSurface
          variant="elevated"
          className="h-28 w-28 items-center justify-center rounded-full">
          <SfIcon name="checkmark.seal.fill" size={50} color={Colors.terminalGreen} />
        </ThemedSurface>
      </View>
    </V2OnboardingScaffold>
  );
}
