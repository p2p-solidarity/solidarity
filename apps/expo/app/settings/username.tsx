import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
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
import { useNameAvailability } from '@/nip05/useNameAvailability';
import { publishChosenPageName } from '@/nip05/publishChosenPageName';
import { PressableScale } from '@/components/common/PressableScale';

export default function UsernameSettings(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const savedUsername = usePreferences((preferences) => preferences.publicPageUsername);
  const registeredUsername = usePreferences((preferences) => preferences.publicPageRegisteredUsername);
  const bindingReady = usePreferences((preferences) => preferences.publicPageBindingReady);
  const setPreference = usePreferences((preferences) => preferences.set);
  const [username, setUsername] = useState(savedUsername);
  const [publishing, setPublishing] = useState(false);
  const validation = useMemo(() => validatePublicPageUsername(username), [username]);
  const { availability, checking, suggestions } = useNameAvailability(username, registeredUsername);

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

  const canSave =
    validation.kind === 'valid' &&
    !checking &&
    availability !== null &&
    availability.status !== 'unavailable' &&
    !(username === savedUsername && username === registeredUsername && bindingReady);

  const save = async (): Promise<void> => {
    if (!canSave || publishing) {
      haptic('error');
      return;
    }
    setPreference('publicPageUsername', username);
    setPreference('publicPagePublishError', '');
    setPreference('publicPageRetryAt', null);
    setPublishing(true);
    try {
      const result = await publishChosenPageName(username);
      switch (result.status) {
        case 'ready':
          setPreference('publicPageRegisteredUsername', result.name);
          setPreference('publicPageBindingReady', true);
          setPreference('publicPagePublishError', '');
          haptic('success');
          pushToast(t('settingsUsername.published'), 'success');
          break;
        case 'registered':
          setPreference('publicPageRegisteredUsername', result.name);
          setPreference('publicPageBindingReady', false);
          setPreference('publicPagePublishError', result.reason);
          haptic('error');
          pushToast(t('settingsUsername.retryNeeded'), 'error');
          break;
        case 'nameTaken':
          setPreference('publicPagePublishError', 'name_taken');
          haptic('error');
          pushToast(t('ob.handle.unavailable'), 'error');
          break;
        case 'renameTooSoon':
          setPreference('publicPagePublishError', 'rename_too_soon');
          setPreference('publicPageRetryAt', result.retryAt ?? null);
          haptic('error');
          pushToast(t('settingsUsername.renameTooSoon'), 'error');
          break;
        case 'localOnly':
          setPreference('publicPagePublishError', result.reason);
          haptic('error');
          pushToast(t('settingsUsername.savedLocally'), 'error');
          break;
      }
    } finally {
      setPublishing(false);
    }
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
              inlinePrefix="creds.id/@"
              kind="handle"
              maxLength={30}
              placeholder="name"
              showClear
              onChangeText={(value) => {
                setUsername(normalizePublicPageUsernameInput(value));
              }}
              error={validation.kind === 'valid' || validation.kind === 'empty' ? null : validationMessage}
            />

            {checking ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator size="small" color={Colors.text3} />
                <ThemedText variant="bodySmall" tone="secondary">{t('ob.handle.checking')}</ThemedText>
              </View>
            ) : availability?.status === 'available' ? (
              <View className="flex-row items-center gap-2">
                <ThemedText variant="label" style={{ color: Colors.terminalGreen }}>✓</ThemedText>
                <ThemedText variant="bodySmall" tone="secondary">{t('ob.handle.available', { h: username })}</ThemedText>
              </View>
            ) : availability?.status === 'unavailable' ? (
              <View className="gap-2">
                <ThemedText variant="bodySmall" tone="error">{t('ob.handle.unavailable')}</ThemedText>
                <View className="flex-row flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <PressableScale
                      key={suggestion}
                      haptic="tap"
                      onPress={() => { setUsername(suggestion); }}
                      accessibilityRole="button"
                      accessibilityLabel={`@${suggestion}`}>
                      <View className="rounded-full px-3 py-2" style={{ backgroundColor: Colors.searchBg }}>
                        <ThemedText variant="label">@{suggestion}</ThemedText>
                      </View>
                    </PressableScale>
                  ))}
                </View>
              </View>
            ) : availability?.status === 'unreachable' ? (
              <ThemedText variant="bodySmall" style={{ color: Colors.warning }}>
                {t('ob.handle.offline')}
              </ThemedText>
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
            loading={publishing}
            disabled={!canSave}
            onPress={() => { void save(); }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
