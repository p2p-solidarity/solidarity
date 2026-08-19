import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
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
import { useNameAvailability } from '@/nip05/useNameAvailability';

import { V2OnboardingScaffold } from './V2OnboardingScaffold';

export function UsernameStep({
  onBack,
  onNext,
  onTaken,
}: {
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onTaken: (username: string, onPickAnother: () => void) => void;
}): ReactNode {
  const { t } = useTranslation();
  const savedUsername = usePreferences((state) => state.publicPageUsername);
  const registeredUsername = usePreferences((state) => state.publicPageRegisteredUsername);
  const setPref = usePreferences((state) => state.set);
  const [username, setUsername] = useState(savedUsername);
  const validation = useMemo(() => validatePublicPageUsername(username), [username]);
  const { availability, checking, suggestions } = useNameAvailability(
    username,
    registeredUsername
  );
  const canContinue =
    validation.kind === 'valid' &&
    !checking &&
    availability !== null &&
    availability.status !== 'unavailable';

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
  const nameIsTaken = availability?.status === 'unavailable';

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
          disabled={!canContinue}
          onPress={() => {
            if (!canContinue) {
              haptic('error');
              return;
            }
            setPref('publicPageUsername', username);
            setPref(
              'publicPagePublishError',
              availability?.status === 'unreachable' ? 'directory_unreachable' : ''
            );
            setPref('publicPageRetryAt', null);
            onNext();
          }}
        />
      }>
      <View style={{ gap: 14, paddingTop: 24 }}>
        <ThemedTextInput
          value={username}
          kind="handle"
          inlinePrefix="creds.id/@"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          placeholder={t('ob.handle.placeholder')}
          onChangeText={(value) => {
            setUsername(normalizePublicPageUsernameInput(value));
          }}
          error={validation.kind === 'valid' || validation.kind === 'empty' ? null : validationMessage}
        />

        {checking ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" color={Colors.text3} />
            <ThemedText variant="bodySmall" tone="secondary">
              {t('ob.handle.checking')}
            </ThemedText>
          </View>
        ) : availability?.status === 'available' ? (
          <View className="flex-row items-center gap-2">
            <ThemedText variant="label" style={{ color: Colors.terminalGreen }}>
              ✓
            </ThemedText>
            <ThemedText variant="bodySmall" tone="secondary">
              {t('ob.handle.available', { h: username })}
            </ThemedText>
          </View>
        ) : nameIsTaken ? (
          <View style={{ gap: 10 }}>
            <ThemedText variant="bodySmall" tone="error">
              @{username} {t('ob.handle.unavailable')}
            </ThemedText>
            {suggestions.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <PressableScale
                    key={suggestion}
                    haptic="tap"
                    onPress={() => { setUsername(suggestion); }}
                    accessibilityRole="button"
                    accessibilityLabel={`@${suggestion}`}>
                    <View
                      className="rounded-full px-3 py-2"
                      style={{ backgroundColor: Colors.searchBg }}>
                      <ThemedText variant="label">@{suggestion}</ThemedText>
                    </View>
                  </PressableScale>
                ))}
              </View>
            ) : null}
            <ThemedButton
              label={t('ob.handle.claim')}
              variant="secondary"
              fullWidth
              onPress={() => {
                onTaken(username, () => { setUsername(''); });
              }}
            />
          </View>
        ) : availability?.status === 'unreachable' ? (
          <ThemedText variant="bodySmall" style={{ color: Colors.warning }}>
            {t('ob.handle.offline')}
          </ThemedText>
        ) : null}

        <ThemedText variant="caption" tone="tertiary">
          {t('ob.handle.preview', { path: publicPagePath(username || 'name') })}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary">
          {t('ob.handle.publicDirectory')}
        </ThemedText>
      </View>
    </V2OnboardingScaffold>
  );
}
