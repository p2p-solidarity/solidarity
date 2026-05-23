/**
 * Root layout — Expo Router stack + global providers + MMKV bootstrap +
 * global ToastOverlay.
 *
 * Boot order (mirrors Swift SolidarityApp.setupApp()):
 *   1. initMmkv()         — derives master key, opens encrypted KV store
 *   2. hydrate contact store from MMKV
 *   3. install i18n catalog
 *   4. render the router stack
 *
 * Splash stays up through step 2 so warm-start render isn't empty.
 */
import 'react-native-gesture-handler';
import '../global.css';

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useContactStore } from '@/contacts/repository';
import { ToastOverlay } from '@/feedback/toast';
import { installI18n } from '@/i18n';
import { initMmkv } from '@/storage';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrateContacts = useContactStore((s) => s.hydrate);

  useEffect(() => {
    void (async () => {
      try {
        await initMmkv();
        await hydrateContacts();
        await installI18n();
      } finally {
        setReady(true);
        await SplashScreen.hideAsync();
      }
    })();
  }, [hydrateContacts]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
          <ToastOverlay />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
