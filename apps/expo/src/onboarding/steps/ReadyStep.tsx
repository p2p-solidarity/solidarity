import { Platform, Switch, View } from 'react-native';
import { useState, type ReactNode } from 'react';

import { ReadyFeatureArt } from '@/components/decor/CredsFeatureArt';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { publicPagePath } from '@/onboarding/publicPageUsername';
import { usePreferences } from '@/settings/preferences';
import { registerForPushNotificationsAsync, unregister } from '@/sakura/pushRegistration';
import { haptic } from '@/feedback/haptics';

import { V2OnboardingScaffold } from './V2OnboardingScaffold';

export function ReadyStep({
  keysGenerated,
  onBack,
  onFirstCheck,
  onBrowse,
}: {
  readonly keysGenerated: boolean;
  readonly onBack: () => void;
  readonly onFirstCheck: () => void;
  readonly onBrowse: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const username = usePreferences((state) => state.publicPageUsername);
  const registeredUsername = usePreferences((state) => state.publicPageRegisteredUsername);
  const bindingReady = usePreferences((state) => state.publicPageBindingReady);
  const notificationsEnabled = usePreferences((state) => state.notificationsEnabled);
  const notificationsRemote = usePreferences((state) => state.notificationsRemote);
  const setPref = usePreferences((state) => state.set);
  const [notificationBusy, setNotificationBusy] = useState(false);

  const updateNotifications = async (next: boolean): Promise<void> => {
    if (notificationBusy) return;
    setNotificationBusy(true);
    try {
      if (next) {
        const registration = await registerForPushNotificationsAsync({ prompt: true });
        if (!registration) {
          haptic('error');
          return;
        }
        setPref('notificationsEnabled', true);
        setPref('notificationsRemote', true);
      } else {
        await unregister();
        setPref('notificationsEnabled', false);
        setPref('notificationsRemote', false);
      }
    } finally {
      setNotificationBusy(false);
    }
  };

  return (
    <V2OnboardingScaffold
      stepIndex={4}
      title={undefined}
      subtitle={undefined}
      onBack={onBack}
      footer={
        <View style={{ gap: 10 }}>
          <ThemedButton
            label={t('ob.done.verify')}
            variant="primary"
            fullWidth
            onPress={onFirstCheck}
          />
          <ThemedButton
            label={t('ob.done.browse')}
            variant="secondary"
            fullWidth
            onPress={onBrowse}
          />
        </View>
      }>
      <View style={{ flex: 1, gap: 14, paddingTop: 8 }}>
        <View className="flex-1 items-center justify-center gap-3">
          {/* Mock ob step 4: the w-feature-6 sparkle art above 「一切就緒」. */}
          <ReadyFeatureArt size={140} />
          <ThemedText variant="headlineMedium">{t('ob.done.title')}</ThemedText>
        </View>
        <ThemedSurface variant="card" padded className="gap-3 rounded-xl">
          <View className="flex-row items-center justify-between gap-4">
            <View className="flex-1 gap-1">
              <ThemedText variant="label">{t('ob.done.notify')}</ThemedText>
              <ThemedText variant="caption" tone="secondary">
                {t('ob.done.notify.sub')}
              </ThemedText>
            </View>
            <Switch
              value={notificationsEnabled && notificationsRemote}
              disabled={notificationBusy}
              onValueChange={(value) => { void updateNotifications(value); }}
              accessibilityLabel={t('ob.done.notify')}
            />
          </View>
        </ThemedSurface>

        <ThemedSurface variant="outlined" padded className="gap-4 rounded-xl">
          <ReadyRow
            done={keysGenerated}
            title={t('ob.done.passkey')}
            detail={t(
              Platform.OS === 'ios'
                ? 'ob.done.passkey.backedUp'
                : 'ob.done.passkey.device',
            )}
          />
          <ReadyRow
            done={bindingReady && registeredUsername.length > 0}
            title={t('ob.done.page')}
            detail={
              bindingReady && registeredUsername.length > 0
                ? publicPagePath(registeredUsername)
                : `${publicPagePath(username)} · ${t('ob.done.page.pending')}`
            }
          />
          <ReadyRow
            done={false}
            title={t('ob.done.first_check')}
            detail={t('ob.done.first_check.pending')}
          />
        </ThemedSurface>
      </View>
    </V2OnboardingScaffold>
  );
}

function ReadyRow({
  done,
  title,
  detail,
}: {
  readonly done: boolean;
  readonly title: string;
  readonly detail: string;
}): ReactNode {
  return (
    <View className="flex-row items-center gap-3">
      <SfIcon
        name={done ? 'checkmark.circle.fill' : 'circle'}
        size={20}
        color={done ? Colors.terminalGreen : Colors.text3}
      />
      <View className="flex-1 gap-0.5">
        <ThemedText variant="label">{title}</ThemedText>
        <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}
