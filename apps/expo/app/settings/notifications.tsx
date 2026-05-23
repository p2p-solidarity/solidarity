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
import { router } from 'expo-router';
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
import { Colors } from '@/constants/Colors';
import { usePreferences } from '@/settings/preferences';

const SYNC_INTERVAL_OPTIONS: readonly { label: string; seconds: number }[] = [
  { label: '15 seconds', seconds: 15 },
  { label: '30 seconds', seconds: 30 },
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
];

const DEFAULTS = {
  enableInAppToast: true,
  enableRemoteNotification: true,
  enableAutoSync: true,
  syncIntervalSeconds: 30,
} as const;

export default function NotificationSettings() {
  const insets = useSafeAreaInsets();
  const inAppToast = usePreferences((s) => s.notificationsInAppToast);
  const remote = usePreferences((s) => s.notificationsRemote);
  const autoSync = usePreferences((s) => s.notificationsAutoSync);
  const intervalSeconds = usePreferences((s) => s.notificationsSyncIntervalSeconds);
  const setPref = usePreferences((s) => s.set);

  const [pickerOpen, setPickerOpen] = useState(false);

  const openSystemSettings = () => {
    void Linking.openSettings();
  };

  const resetToDefaults = () => {
    setPref('notificationsInAppToast', DEFAULTS.enableInAppToast);
    setPref('notificationsRemote', DEFAULTS.enableRemoteNotification);
    setPref('notificationsAutoSync', DEFAULTS.enableAutoSync);
    setPref('notificationsSyncIntervalSeconds', DEFAULTS.syncIntervalSeconds);
  };

  const currentIntervalLabel =
    SYNC_INTERVAL_OPTIONS.find((o) => o.seconds === intervalSeconds)?.label ?? '—';

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Notifications" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* In-App Notifications */}
          <SettingsBlockSection
            title="In-App Notifications"
            footer="Toast notifications appear at the top of the screen when the app is in foreground."
          >
            <SettingsBlockToggleRow
              icon="bell.badge.fill"
              title="In-App Toast"
              subtitle="Show toast when Sakura message arrives"
              value={inAppToast}
              onValueChange={(v) => { setPref('notificationsInAppToast', v); }}
            />
          </SettingsBlockSection>

          {/* Remote Notifications */}
          <SettingsBlockSection
            title="Remote Notifications"
            footer="When disabled, you won't receive push notifications from other users sending Sakura messages."
          >
            <SettingsBlockToggleRow
              icon="iphone.radiowaves.left.and.right"
              title="Remote Notifications"
              subtitle="Receive push notifications from others"
              value={remote}
              onValueChange={(v) => { setPref('notificationsRemote', v); }}
            />
            <SettingsBlockRow
              icon="gearshape"
              title="System Notification Settings"
              trailingText="Open"
              showsChevron={false}
              onPress={openSystemSettings}
            />
          </SettingsBlockSection>

          {/* Sync Settings */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title="Sync Settings" />
            <View className="px-4 gap-2">
              <SettingsBlockToggleRow
                icon="arrow.triangle.2.circlepath"
                title="Auto-Sync"
                subtitle="Automatically check for new messages"
                value={autoSync}
                onValueChange={(v) => { setPref('notificationsAutoSync', v); }}
              />
              {autoSync ? (
                <Pressable
                  onPress={() => { setPickerOpen(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Sync Interval"
                  className="bg-mutedSurface rounded-xl flex-row items-center active:opacity-80"
                  style={{ paddingHorizontal: 14, paddingVertical: 14 }}
                >
                  <View
                    style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
                  >
                    <SfIcon name="timer" size={14} color={Colors.text1} />
                  </View>
                  <Text className="text-text1 text-[15px] flex-1">Sync Interval</Text>
                  <Text className="text-text2 text-[13px]" style={{ marginRight: 6 }}>
                    {currentIntervalLabel}
                  </Text>
                  <SfIcon name="chevron.up.chevron.down" size={11} color={Colors.text3} />
                </Pressable>
              ) : null}
            </View>
            <Text className="px-4 text-text3 text-[12px]">
              Auto-sync periodically checks for new messages. Higher intervals reduce battery and network usage.
            </Text>
          </View>

          {/* Reset */}
          <SettingsBlockSection title="Reset">
            <SettingsBlockDangerRow
              icon="arrow.counterclockwise"
              title="Reset to Defaults"
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
              Sync Interval
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
                    {opt.label}
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
