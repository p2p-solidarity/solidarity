/**
 * Root layout — Expo Router stack + global providers + MMKV bootstrap +
 * global ToastOverlay + deep-link routing.
 *
 * The `react-native-get-random-values` polyfill MUST be imported before
 * anything that touches @noble/curves or @noble/ciphers (they call
 * `crypto.getRandomValues` synchronously at module top). RN doesn't ship
 * Web Crypto by default.
 *
 * Boot order (mirrors Swift SolidarityApp.setupApp()):
 *   1. install crypto polyfill (top-of-file import)
 *   2. initMmkv()         — derives master key, opens encrypted KV store
 *   3. hydratePreferences + hydrateContacts
 *   4. install i18n catalog
 *   5. attach deep-link listener
 *   6. render the router stack
 *
 * Splash stays up through step 3 so warm-start render isn't empty.
 */
import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import '../global.css';

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useContactStore } from '@/contacts/repository';
import { handleDeepLink } from '@/deeplink/router';
import { ToastOverlay } from '@/feedback/toast';
import { installI18n } from '@/i18n';
import { hydratePreferences } from '@/settings/preferences';
import { initMmkv } from '@/storage';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrateContacts = useContactStore((s) => s.hydrate);

  useEffect(() => {
    void (async () => {
      try {
        await initMmkv();
        hydratePreferences();
        await hydrateContacts();
        await installI18n();
        const initial = await Linking.getInitialURL();
        if (initial) handleDeepLink(initial);
      } finally {
        setReady(true);
        await SplashScreen.hideAsync();
      }
    })();
  }, [hydrateContacts]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });
    return () => { sub.remove(); };
  }, []);

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
