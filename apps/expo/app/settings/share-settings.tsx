/**
 * Share Settings — placeholder hosted at /settings/share-settings.
 *
 * Swift's ShareSettingsView
 *   (solidarity/Views/SharingViews/ShareSettingsView.swift)
 * is per-field share toggles + QR preview + proof badges. Until that screen
 * is ported in Wave 2, this route renders the existing
 * SelectiveDisclosureSettingsView body under the "Share Settings" title so
 * the Settings hub row keeps landing on a real, usable screen instead of
 * the wrong destination.
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';

import SelectiveDisclosureBody from './disclosure';

export default function ShareSettings() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Share Settings" />
      <SelectiveDisclosureBody headerless />
    </View>
  );
}
