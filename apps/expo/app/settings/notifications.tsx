/**
 * Notifications — 1:1 port of
 * solidarity/Views/SettingsViews/NotificationSettingsView.swift.
 *
 * Four sections:
 *   1. In-App Notifications — In-App Toast toggle + footer.
 *   2. Remote Notifications — Remote Notifications toggle, System Notification
 *      Settings row that opens the iOS Settings.app deep-link.
 *   3. Sync Settings — Auto-Sync toggle. When ON, also shows the Sync Interval
 *      menu (15s / 30s / 1m / 5m).
 *   4. Reset — destructive "Reset to Defaults" row.
 */
import { safeBack } from '@/navigation/safeBack';
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { useRecentUpdatesStore } from '@/contacts/recentUpdates';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  registerForPushNotificationsAsync,
  unregister,
} from '@/sakura/pushRegistration';
import { usePreferences } from '@/settings/preferences';

const SYNC_INTERVAL_OPTIONS: readonly { labelKey: string; seconds: number }[] = [
  { labelKey: 'notifications.interval.15s', seconds: 15 },
  { labelKey: 'notifications.interval.30s', seconds: 30 },
  { labelKey: 'notifications.interval.1m', seconds: 60 },
  { labelKey: 'notifications.interval.5m', seconds: 300 },
];

const DEFAULTS = {
  enableInAppToast: true,
  enableRemoteNotification: true,
  enableAutoSync: true,
  syncIntervalSeconds: 30,
} as const;

export default function NotificationSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const inAppToast = usePreferences((s) => s.notificationsInAppToast);
  const remote = usePreferences((s) => s.notificationsRemote);
  const autoSync = usePreferences((s) => s.notificationsAutoSync);
  const intervalSeconds = usePreferences((s) => s.notificationsSyncIntervalSeconds);
  const setPref = usePreferences((s) => s.set);
  const recentUpdatesEnabled = useRecentUpdatesStore((s) => s.enabled);
  const setRecentUpdatesEnabled = useRecentUpdatesStore((s) => s.setEnabled);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);

  const openSystemSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      showError({
        context: 'Notifications › System Settings',
        summary: t('notifications.systemSettings.openFailed'),
        error,
      });
    }
  };

  // Toggling Remote Notifications is the explicit opt-in/opt-out action
  // (R25): turning it ON is the ONE path allowed to raise the OS permission
  // prompt and register with the relay; turning it OFF tears the registration
  // down. No automatic cold-launch prompt happens without this.
  const onRemoteToggle = async (next: boolean) => {
    if (remoteBusy || next === remote) return;
    setRemoteBusy(true);
    try {
      if (next) {
        const registration = await registerForPushNotificationsAsync({ prompt: true });
        if (!registration) {
          setPref('notificationsRemote', false);
          pushToast(t('notifications.remote.permissionNeeded'), 'warning');
          return;
        }
        setPref('notificationsRemote', true);
        return;
      }

      await unregister();
      setPref('notificationsRemote', false);
    } catch (error) {
      showError({
        context: 'Notifications › Remote Notifications',
        summary: t('notifications.remote.updateFailed'),
        error,
      });
    } finally {
      setRemoteBusy(false);
    }
  };

  const resetToDefaults = () => {
    setPref('notificationsInAppToast', DEFAULTS.enableInAppToast);
    // Restore the preference only — reset is not a deliberate "enable
    // notifications" action, so it must not raise a prompt. The root layout's
    // opt-in effect reconciles a silent registration if the OS already
    // granted permission.
    setPref('notificationsRemote', DEFAULTS.enableRemoteNotification);
    setPref('notificationsAutoSync', DEFAULTS.enableAutoSync);
    setPref('notificationsSyncIntervalSeconds', DEFAULTS.syncIntervalSeconds);
    setRecentUpdatesEnabled(true);
  };

  const currentIntervalKey =
    SYNC_INTERVAL_OPTIONS.find((o) => o.seconds === intervalSeconds)?.labelKey;
  const currentIntervalLabel = currentIntervalKey ? t(currentIntervalKey) : '—';

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('notifications.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* In-App Notifications */}
          <SettingsBlockSection
            title={t('notifications.inApp.header')}
            footer={t('notifications.inApp.footer')}
          >
            <SettingsBlockToggleRow
              icon="bell.badge.fill"
              title={t('notifications.inApp.toastTitle')}
              subtitle={t('notifications.inApp.toastSubtitle')}
              value={inAppToast}
              onValueChange={(v) => { setPref('notificationsInAppToast', v); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection
            title={t('notifications.contactUpdates.header')}
            footer={t('notifications.contactUpdates.footer')}
          >
            <SettingsBlockToggleRow
              icon="person.2.fill"
              title={t('notifications.contactUpdates.title')}
              subtitle={t('notifications.contactUpdates.subtitle')}
              value={recentUpdatesEnabled}
              onValueChange={setRecentUpdatesEnabled}
            />
          </SettingsBlockSection>

          {/* Remote Notifications */}
          <SettingsBlockSection
            title={t('notifications.remote.header')}
            footer={t('notifications.remote.footer')}
          >
            <SettingsBlockToggleRow
              icon="iphone.radiowaves.left.and.right"
              title={t('notifications.remote.title')}
              subtitle={t('notifications.remote.subtitle')}
              value={remote}
              onValueChange={(next) => { void onRemoteToggle(next); }}
              disabled={remoteBusy}
            />
            <SettingsBlockRow
              icon="gearshape"
              title={t('notifications.systemSettings.title')}
              trailingText={t('notifications.systemSettings.open')}
              showsChevron={false}
              onPress={() => { void openSystemSettings(); }}
            />
          </SettingsBlockSection>

          {/* Sync Settings */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title={t('notifications.sync.header')} />
            <View className="px-4 gap-2">
              <SettingsBlockToggleRow
                icon="arrow.triangle.2.circlepath"
                title={t('notifications.autoSync.title')}
                subtitle={t('notifications.autoSync.subtitle')}
                value={autoSync}
                onValueChange={(v) => { setPref('notificationsAutoSync', v); }}
              />
              {autoSync ? (
                <Pressable
                  onPress={() => { setPickerOpen(true); }}
                  accessibilityRole="button"
                  accessibilityLabel={t('notifications.syncInterval.title')}
                  className="bg-mutedSurface rounded-xl flex-row items-center active:opacity-80"
                  style={{ paddingHorizontal: 14, paddingVertical: 14 }}
                >
                  <View
                    style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
                  >
                    <SfIcon name="timer" size={14} color={Colors.text1} />
                  </View>
                  <Text className="text-text1 text-[15px] flex-1">{t('notifications.syncInterval.title')}</Text>
                  <Text className="text-text2 text-[13px]" style={{ marginRight: 6 }}>
                    {currentIntervalLabel}
                  </Text>
                  <SfIcon name="chevron.up.chevron.down" size={11} color={Colors.text3} />
                </Pressable>
              ) : null}
            </View>
            <Text className="px-4 text-text3 text-[12px]">
              {t('notifications.sync.footer')}
            </Text>
          </View>

          {/* Reset */}
          <SettingsBlockSection title={t('notifications.reset.header')}>
            <SettingsBlockDangerRow
              icon="arrow.counterclockwise"
              title={t('notifications.reset.title')}
              onPress={resetToDefaults}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>

      {/* Sync Interval picker modal */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setPickerOpen(false); }}
      >
        <Pressable
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => { setPickerOpen(false); }}
        >
          <View
            className="bg-cardBg rounded-2xl"
            style={{ width: 280, paddingVertical: 8 }}
          >
            <Text
              className="text-text2 text-[13px]"
              style={{ paddingHorizontal: 16, paddingVertical: 8 }}
            >
              {t('notifications.syncInterval.title')}
            </Text>
            {SYNC_INTERVAL_OPTIONS.map((opt) => {
              const active = opt.seconds === intervalSeconds;
              return (
                <Pressable
                  key={opt.seconds}
                  onPress={() => {
                    setPref('notificationsSyncIntervalSeconds', opt.seconds);
                    setPickerOpen(false);
                  }}
                  accessibilityRole="button"
                  className="flex-row items-center active:opacity-80"
                  style={{ paddingHorizontal: 16, paddingVertical: 12 }}
                >
                  <Text
                    className="text-text1 text-[15px] flex-1"
                    style={{ fontWeight: active ? '600' : '400' }}
                  >
                    {t(opt.labelKey)}
                  </Text>
                  {active ? (
                    <SfIcon name="checkmark" size={14} weight="semibold" color={Colors.primaryBlue} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
