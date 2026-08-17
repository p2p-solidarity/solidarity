import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedButton, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import {
  normalizePublicPageUsernameInput,
  publicPagePath,
  validatePublicPageUsername,
} from '@/onboarding/publicPageUsername';
import { usePreferences } from '@/settings/preferences';

import { V2OnboardingScaffold } from './V2OnboardingScaffold';

export function UsernameStep({
  onBack,
  onNext,
}: {
  readonly onBack: () => void;
  readonly onNext: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const savedUsername = usePreferences((state) => state.publicPageUsername);
  const setPref = usePreferences((state) => state.set);
  const [username, setUsername] = useState(savedUsername);
  const validation = useMemo(() => validatePublicPageUsername(username), [username]);

  const validationMessage = (() => {
    switch (validation.kind) {
      case 'empty':
        return null;
      case 'tooShort':
        return t('ob.handle.short');
      case 'tooLong':
        return t('ob.handle.long');
      case 'invalidCharacters':
        return t('ob.handle.charset');
      case 'reserved':
        return t('ob.handle.reserved');
      case 'valid':
        return t('ob.handle.valid', { h: username });
    }
  })();

  return (
    <V2OnboardingScaffold
      stepIndex={1}
      title={t('ob.handle.title')}
      subtitle={t('ob.handle.sub')}
      onBack={onBack}
      footer={
        <ThemedButton
          label={t('ob.handle.next')}
          variant="primary"
          fullWidth
          disabled={validation.kind !== 'valid'}
          onPress={() => {
            if (validation.kind !== 'valid') {
              haptic('error');
              return;
            }
            setPref('publicPageUsername', username);
            onNext();
          }}
        />
      }>
      <View style={{ gap: 14, paddingTop: 24 }}>
        <ThemedTextInput
          value={username}
          inlinePrefix="creds.id/"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          placeholder="gimmy"
          onChangeText={(value) => {
            setUsername(normalizePublicPageUsernameInput(value));
          }}
          error={validation.kind === 'valid' || validation.kind === 'empty' ? null : validationMessage}
        />

        {validation.kind === 'valid' ? (
          <View className="flex-row items-center gap-2">
            <ThemedText variant="label" style={{ color: Colors.terminalGreen }}>
              ✓
            </ThemedText>
            <ThemedText variant="bodySmall" tone="secondary">
              {validationMessage}
            </ThemedText>
          </View>
        ) : null}

        <ThemedText variant="caption" tone="tertiary">
          {t('ob.handle.preview', { path: publicPagePath(username || 'name') })}
        </ThemedText>
      </View>
    </V2OnboardingScaffold>
  );
}
