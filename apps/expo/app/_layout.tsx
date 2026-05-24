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
import { Appearance } from 'react-native';
import { Stack } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useReceivedCard } from '@/cards/receivedCard';
import { ReceivedCardSheet } from '@/components/cards/ReceivedCardSheet';
import { useContactStore } from '@/contacts/repository';
import { handleDeepLink } from '@/deeplink/router';
import { ToastOverlay } from '@/feedback/toast';
import { useIdentityData } from '@/identity';
import { installI18n } from '@/i18n';
import { hydrateSensitiveActionPolicy } from '@/keychain';
import { syncOnce } from '@/sakura/inbox';
import { registerForPushNotificationsAsync } from '@/sakura/pushRegistration';
import { hydratePreferences, usePreferences } from '@/settings/preferences';
import { initMmkv } from '@/storage';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrateContacts = useContactStore((s) => s.hydrate);
  const receivedCard = useReceivedCard((s) => s.card);
  const receivedVerification = useReceivedCard((s) => s.verificationStatus);
  const dismissReceived = useReceivedCard((s) => s.dismiss);
  const upsertContact = useContactStore((s) => s.upsert);
  // Swift ThemeManager.applyColorScheme → here we forward the user pref to
  // RN's Appearance. NativeWind reads colorScheme from Appearance on native,
  // so toggling Light/Dark/System in Appearance settings actually flips
  // every `bg-pageBg` / `text-text1` style without a relaunch.
  const appColorScheme = usePreferences((s) => s.appColorScheme);
  useEffect(() => {
    Appearance.setColorScheme(appColorScheme === 'system' ? null : appColorScheme);
  }, [appColorScheme]);

  useEffect(() => {
    void (async () => {
      try {
        await initMmkv();
        hydratePreferences();
        hydrateSensitiveActionPolicy();
        await hydrateContacts();
        await useIdentityData.getState().hydrate();
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

  // Sakura push rail — mirrors Swift AppDelegate.didFinishLaunchingWithOptions
  // + didReceiveRemoteNotification. Registration is fire-and-forget per
  // Rule 10 (never await on first paint); listeners trigger an inbox sync
  // whenever the OS hands us a notification (foreground or interaction tap).
  useEffect(() => {
    // Permission denied / no token / relay down — Swift swallows the
    // equivalent error too. The user can retry from Settings.
    void registerForPushNotificationsAsync().catch(() => undefined);
    const received = Notifications.addNotificationReceivedListener(() => {
      // Inbox decrypt failures are not surfaced to the user; mirrors
      // Swift MessageService logging behaviour.
      void syncOnce().catch(() => undefined);
    });
    const response = Notifications.addNotificationResponseReceivedListener(() => {
      void syncOnce().catch(() => undefined);
    });
    const tokenChange = Notifications.addPushTokenListener(() => {
      void registerForPushNotificationsAsync().catch(() => undefined);
    });
    return () => {
      received.remove();
      response.remove();
      tokenChange.remove();
    };
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
          <ToastOverlay />
          <ReceivedCardSheet
            visible={receivedCard !== null}
            card={receivedCard}
            verificationStatus={receivedVerification}
            onSave={async (contact) => {
              await upsertContact(contact);
              dismissReceived();
            }}
            onDismiss={dismissReceived}
          />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
