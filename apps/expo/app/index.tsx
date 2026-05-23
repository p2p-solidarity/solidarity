/**
 * Onboarding gate — mirrors Swift ContentView.swift conditional based on
 * AppStorage("hasCompletedOnboarding"). Replaced here with a hydrated MMKV
 * flag (see src/storage/onboarding.ts once Phase 1 lands).
 */
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-pageBg">
      <Text className="text-text1 text-2xl font-semibold">Solidarity</Text>
      <Text className="text-text2 mt-2">Expo scaffold — port in progress</Text>
    </View>
  );
}
