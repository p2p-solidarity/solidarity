import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';
import {
  normalizePublicPageUsernameInput,
  publicPagePath,
  validatePublicPageUsername,
} from '@/onboarding/publicPageUsername';
import { usePreferences } from '@/settings/preferences';

export default function UsernameSettings(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const savedUsername = usePreferences((preferences) => preferences.publicPageUsername);
  const setPreference = usePreferences((preferences) => preferences.set);
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

  const save = (): void => {
    if (validation.kind !== 'valid') {
      haptic('error');
      return;
    }
    setPreference('publicPageUsername', username);
    haptic('success');
    pushToast(t('settingsUsername.saved'), 'success');
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('settingsUsername.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 40 }}>
        <View className="gap-4">
          <ThemedSurface variant="card" padded className="gap-4 rounded-2xl">
            <ThemedText variant="label">{t('settingsUsername.pageAddress')}</ThemedText>
            <ThemedTextInput
              value={username}
              inlinePrefix="creds.id/"
              kind="handle"
              maxLength={30}
              placeholder="name"
              showClear
              onChangeText={(value) => {
                setUsername(normalizePublicPageUsernameInput(value));
              }}
              error={validation.kind === 'valid' || validation.kind === 'empty' ? null : validationMessage}
            />

            {validation.kind === 'valid' ? (
              <View className="flex-row items-center gap-2">
                <ThemedText variant="label" style={{ color: Colors.terminalGreen }}>✓</ThemedText>
                <ThemedText variant="bodySmall" tone="secondary">{validationMessage}</ThemedText>
              </View>
            ) : null}

            <ThemedText variant="caption" tone="tertiary">
              {t('settingsUsername.preview', { path: publicPagePath(username || 'name') })}
            </ThemedText>
          </ThemedSurface>

          <ThemedSurface variant="inset" padded className="rounded-2xl">
            <ThemedText variant="bodySmall" tone="secondary">
              {t('settingsUsername.serviceNote')}
            </ThemedText>
          </ThemedSurface>

          <ThemedButton
            label={t('settingsUsername.save')}
            variant="primary"
            fullWidth
            disabled={validation.kind !== 'valid' || username === savedUsername}
            onPress={save}
          />
        </View>
      </ScrollView>
    </View>
  );
}
