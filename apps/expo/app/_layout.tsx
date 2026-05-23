/**
 * Root layout — Expo Router stack + global providers.
 *
 * Mirrors SolidarityApp.swift:
 *  - @StateObject singletons → Zustand stores hydrated here.
 *  - .onAppear setupApp() → useEffect with init pipeline.
 *  - .onOpenURL → expo-linking (handled by router automatically).
 */
import 'react-native-gesture-handler';
import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
