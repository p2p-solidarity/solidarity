/**
 * Root layout — Expo Router stack + global providers + MMKV bootstrap.
 *
 * Boot order (matters; mirrors Swift SolidarityApp.setupApp()):
 *   1. initMmkv()         — derives master key, hydrates the encrypted KV store
 *   2. hydrate contact store
 *   3. render the router stack
 *
 * Splash screen stays up until step 2 resolves to avoid flashing an empty
 * People tab on warm starts (aniseekr-expo rule 10).
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
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
