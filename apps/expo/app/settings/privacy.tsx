/**
 * Privacy Settings — 1:1 port of
 * solidarity/Views/SettingsViews/PrivacySettingsView.swift.
 *
 * Swift's PrivacySettingsView is a NavigationStack wrapping
 * SelectiveDisclosureSettingsView under the "Privacy Settings" title. We
 * mirror the same shape by re-rendering the disclosure body component
 * (default export of `disclosure.tsx`) under the alternate title — same
 * trick used by share-settings.tsx so the Wave 1 disclosure stack stays
 * the single source of truth.
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
