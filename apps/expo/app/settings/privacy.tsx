/**
 * Privacy Settings — 1:1 port of
 * solidarity/Views/SettingsViews/PrivacySettingsView.swift.
 *
 * The Swift version is a NavigationStack wrapping SelectiveDisclosureSettingsView
 * with title "Privacy Settings" and a SettingsBackToolbar. Since the Expo
 * settings stack already shows a back button via SettingsBackToolbar, this
 * file simply renders the same content as `disclosure.tsx` but with the
 * "Privacy Settings" title — matching Swift behaviour exactly.
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';

import SelectiveDisclosureBody from './disclosure';

export default function PrivacySettings() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Privacy Settings" />
      <SelectiveDisclosureBody headerless />
    </View>
  );
}
