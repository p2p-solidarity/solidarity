/**
 * Root layout — Expo Router stack + global providers + MMKV bootstrap +
 * global ToastOverlay + deep-link routing.
 *
 * The `react-native-get-random-values` polyfill MUST be imported before
 * anything that touches @noble/curves or @noble/ciphers (they call
 * `crypto.getRandomValues` synchronously at module top). RN doesn't ship
 * Web Crypto by default.
 *
 * Boot order (Path A — manifest-first, sub-50 ms cold launch):
 *   1. install crypto polyfill (top-of-file import)
 *   2. await initMmkv()                  — Keychain hop + MMKV open
 *   2b. await warmNostrKeyMirror()       — resident already; warms the
 *                                          userKey.ts sync-mirror cache
 *   3. sync seed all feature manifests   — zero await, frame-1 ready
 *      (cards, contacts, groups, vault, shoutouts, credentials, issuers)
 *   4. await installI18n + preferences   — cheap, on-the-spot
 *   5. setReady(true) → splash hides     — UI paints from manifests
 *   6. fire-and-forget bulk hydrate      — per-record decrypt in background;
 *                                          fills the `details` maps and
 *                                          rebuilds the manifest if it was
 *                                          missing (migration path).
 *
 * Splash hides as soon as manifests are seeded so warm-start render isn't
 * empty. The bulk hydrate runs while the user is already looking at the
 * Me / People / Share tabs and silently swaps placeholder rows for full
 * data the moment each store's `details` map populates.
 */
import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import '../global.css';

import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useCardStore } from '@/cards/cardManager';
import { useReceivedCard } from '@/cards/receivedCard';
import { ReceivedCardSheet } from '@/components/cards/ReceivedCardSheet';
import { VerifiedPageResultSheet } from '@/components/scan/VerifiedPageResultSheet';
import { useContactStore } from '@/contacts/repository';
import { useCredentialStore } from '@/credentials/store';
import { useIssuerMetadataStore } from '@/credentials/issuerStore';
import { handleDeepLink } from '@/deeplink/router';
import { AppAlertOverlay } from '@/feedback/appAlert';
import { ConfirmDialogOverlay } from '@/feedback/confirmDialog';
import { ToastOverlay } from '@/feedback/toast';
import { prepareLeaveCards } from '@/contacts/leaveCardInbox';
import { prepareRecentUpdates } from '@/contacts/recentUpdates';
import { useGroupStore } from '@/groups/store';
import { useIdentityData } from '@/identity';
import { installI18n } from '@/i18n';
import { hydrateSensitiveActionPolicy } from '@/keychain';
import { warmBadgeStatusCache } from '@/badges/badgeStatusCache';
import { warmNostrKeyMirror } from '@/nostr/userKey';
import { PearConsentOverlay, PearPresentConsentOverlay } from '@/pear/consent';
import { hydrateProfileSnapshots } from '@/people/profileSnapshots';
import { hydrateProfile } from '@/profile/store';
import { syncOnce } from '@/sakura/inbox';
import { registerForPushNotificationsAsync } from '@/sakura/pushRegistration';
import { hydratePreferences, usePreferences } from '@/settings/preferences';
import { useShoutoutStore } from '@/shoutouts/store';
import { initMmkv, ManifestStorage } from '@/storage';
import { useVaultStore } from '@/vault/store';
import { PRIMARY_TAB_HREFS } from '@/navigation/primaryTabs';

import { CARDS_MANIFEST_SCOPE } from '@/cards/cardManifest';
import { CONTACTS_MANIFEST_SCOPE } from '@/contacts/contactManifest';
import { CREDENTIALS_MANIFEST_SCOPE } from '@/credentials/credentialManifest';
import { ISSUERS_MANIFEST_SCOPE } from '@/credentials/issuerManifest';
import { GROUPS_MANIFEST_SCOPE } from '@/groups/groupManifest';
import { SHOUTOUTS_MANIFEST_SCOPE } from '@/shoutouts/shoutoutManifest';
import { VAULT_MANIFEST_SCOPE } from '@/vault/vaultManifest';

// App-wide JS error boundary (wraps <Stack> below so it gets the React
// component stack of any render throw) + global uncaught-JS handler (installed
// as a side effect of this import). NATIVE crashes are out of its reach — those
// self-identify in the crash report via MrzInstallCrashDiagnostics. See
// src/feedback/RootErrorBoundary.tsx and the CLAUDE.md "Error handling" section.
import { AppErrorBoundary } from '@/feedback/RootErrorBoundary';

/**
 * Migration check — on first launch after the manifest-pattern upgrade,
 * none of the per-store manifests exist yet but the encrypted records do.
 * Block the splash briefly that one time so the user sees populated lists
 * instead of a blank frame followed by a pop-in. After this runs once,
 * every store has written its manifest (even an empty `[]`), so the
 * `exists()` check returns true on every subsequent boot and we skip the
 * await entirely.
 */
const MIGRATION_SCOPES = [
  CARDS_MANIFEST_SCOPE,
  CONTACTS_MANIFEST_SCOPE,
  GROUPS_MANIFEST_SCOPE,
  VAULT_MANIFEST_SCOPE,
  SHOUTOUTS_MANIFEST_SCOPE,
  CREDENTIALS_MANIFEST_SCOPE,
  ISSUERS_MANIFEST_SCOPE,
] as const;

void SplashScreen.preventAutoHideAsync();

const BOOT_TIMEOUT_MS = 8000;
const BOOT_LOG_PREFIX = '[solidarity:boot]';

function logBoot(message: string, payload?: unknown): void {
  if (payload === undefined) {
    console.info(`${BOOT_LOG_PREFIX} ${message}`);
    return;
  }
  console.info(`${BOOT_LOG_PREFIX} ${message}`, payload);
}

function warnBoot(message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(`${BOOT_LOG_PREFIX} ${message}`);
    return;
  }
  console.warn(`${BOOT_LOG_PREFIX} ${message}`, error);
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const receivedCard = useReceivedCard((s) => s.card);
  const receivedVerification = useReceivedCard((s) => s.verificationStatus);
  const receivedSource = useReceivedCard((s) => s.source);
  const receivedSealedRoute = useReceivedCard((s) => s.sealedRoute);
  const dismissReceived = useReceivedCard((s) => s.dismiss);
  const upsertContact = useContactStore((s) => s.upsert);
  // Swift ThemeManager.applyColorScheme → here we forward the user pref to
  // RN's Appearance. NativeWind reads colorScheme from Appearance on native,
  // so toggling Light/Dark/System in Appearance settings actually flips
  // every `bg-pageBg` / `text-text1` style without a relaunch.
  const appColorScheme = usePreferences((s) => s.appColorScheme);
  // Opt-in gate for the Sakura push rail (R25). Reflects the persisted value
  // once boot runs `hydratePreferences()` (before `ready` flips true), so the
  // registration effect below reads the real preference, not the default.
  const remoteNotificationsEnabled = usePreferences((s) => s.notificationsRemote);
  const hasCompletedOnboarding = usePreferences((s) => s.hasCompletedOnboarding);
  useEffect(() => {
    Appearance.setColorScheme(appColorScheme === 'system' ? 'unspecified' : appColorScheme);
  }, [appColorScheme]);

  useEffect(() => {
    let cancelled = false;
    let shown = false;

    const showApp = async (reason: string) => {
      if (cancelled || shown) return;
      shown = true;
      logBoot(`show-app:${reason}`);
      setReady(true);
      try {
        await SplashScreen.hideAsync();
      } catch (error) {
        warnBoot('splash-hide-failed', error);
      }
    };

    const hydrateDetailsInBackground = () => {
      void useCardStore.getState().hydrate();
      void useContactStore.getState().hydrate();
      void useGroupStore.getState().hydrate();
      void useVaultStore.getState().hydrate();
      void useShoutoutStore.getState().hydrate();
      void useCredentialStore.getState().hydrate();
      void useIssuerMetadataStore.getState().hydrate();
      void useIdentityData.getState().hydrate();
    };

    const boot = async () => {
      try {
        logBoot('mmkv:start');
        await initMmkv();
        logBoot('mmkv:done');
        // Warm the Nostr sync mirror's MMKV reference NOW so every later
        // `hasNostrKeySync()` call (e.g. the Verify tab's badge-bindings
        // row) is a real synchronous read instead of a cold-cache `false`
        // — see userKey.ts's module doc. Cheap: `@/storage/mmkv` is
        // already resident from `initMmkv()` above.
        await warmNostrKeyMirror();
        // Same pattern for the persisted badge-verification cache, so the
        // Me tab's chips can seed the last known state synchronously on
        // first render (badgeStatusCache doc).
        await warmBadgeStatusCache();
        await Promise.all([prepareRecentUpdates(), prepareLeaveCards()]);
        // Sync, sub-millisecond: each store reads its plaintext manifest
        // from MMKV and seeds the zustand initial state. List/hero views
        // can render on the next frame without any decryption.
        useCardStore.getState().seedFromManifest();
        useContactStore.getState().seedFromManifest();
        useGroupStore.getState().seedFromManifest();
        useVaultStore.getState().seedFromManifest();
        useShoutoutStore.getState().seedFromManifest();
        useCredentialStore.getState().seedFromManifest();
        useIssuerMetadataStore.getState().seedFromManifest();
        logBoot('manifest-seed:done');

        hydratePreferences();
        hydrateSensitiveActionPolicy();
        hydrateProfile();
        hydrateProfileSnapshots();
        logBoot('preferences:done');

        // First-boot migration: if any manifest is missing, block splash
        // for the parallel bulk-decrypt so lists paint on frame 1 instead
        // of flashing empty rows. Runs at most once per device.
        const needsMigration = MIGRATION_SCOPES.some(
          (scope) => !ManifestStorage.exists(scope)
        );
        if (needsMigration) {
          logBoot('migration:start');
          await Promise.all([
            useCardStore.getState().hydrate(),
            useContactStore.getState().hydrate(),
            useGroupStore.getState().hydrate(),
            useVaultStore.getState().hydrate(),
            useShoutoutStore.getState().hydrate(),
            useCredentialStore.getState().hydrate(),
            useIssuerMetadataStore.getState().hydrate(),
          ]);
          logBoot('migration:done');
        } else {
          logBoot('migration:skip');
        }

        logBoot('i18n:start');
        // Pass the persisted language choice so the user's explicit selection
        // survives relaunch. hydratePreferences() ran above, so the store now
        // holds the MMKV value; an empty string means "follow device locale".
        await installI18n(usePreferences.getState().language);
        logBoot('i18n:done');
        const initial = await Linking.getInitialURL();
        if (initial) {
          logBoot('deeplink:initial', initial);
          handleDeepLink(initial);
        }
        await showApp('boot-complete');
      } catch (error) {
        warnBoot('boot-failed-before-first-paint', error);
        await showApp('boot-error');
      } finally {
        // Background bulk-decrypt for the steady-state path (manifests
        // already exist). Idempotent — each store's `hydrate()` checks
        // its own `detailsHydrated` flag and bails out cheaply if it's
        // already been called by the migration branch above.
        if (!cancelled) hydrateDetailsInBackground();
      }
    };

    const timeout = setTimeout(() => {
      void showApp(`timeout-${BOOT_TIMEOUT_MS}ms`);
    }, BOOT_TIMEOUT_MS);

    void boot().finally(() => {
      clearTimeout(timeout);
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });
    return () => { sub.remove(); };
  }, []);

  // Sakura push rail — inbox-sync listeners are always safe to attach: they
  // only fire when the OS actually delivers a notification (none, if the user
  // opted out), and they never touch permission. Mirrors Swift
  // AppDelegate.didReceiveRemoteNotification.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      // Inbox decrypt failures are not surfaced to the user; mirrors
      // Swift MessageService logging behaviour.
      if (usePreferences.getState().hasCompletedOnboarding) {
        void syncOnce().catch(() => undefined);
      }
    });
    const response = Notifications.addNotificationResponseReceivedListener(() => {
      if (usePreferences.getState().hasCompletedOnboarding) {
        void syncOnce().catch(() => undefined);
      }
    });
    return () => {
      received.remove();
      response.remove();
    };
  }, []);

  // Registration is opt-in gated (R25). We only register once boot has
  // hydrated the persisted preference (`ready`) AND remote notifications are
  // enabled. The automatic path NEVER prompts — it registers only if the OS
  // already granted permission — so a user who never opted in never sees a
  // system dialog on cold launch. Fire-and-forget per Rule 10.
  useEffect(() => {
    if (!ready || !hasCompletedOnboarding || !remoteNotificationsEnabled) return;
    void registerForPushNotificationsAsync().catch(() => undefined);
    const tokenChange = Notifications.addPushTokenListener(() => {
      void registerForPushNotificationsAsync().catch(() => undefined);
    });
    return () => {
      tokenChange.remove();
    };
  }, [hasCompletedOnboarding, ready, remoteNotificationsEnabled]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <AppErrorBoundary>
            <Stack screenOptions={{ headerShown: false }} />
          </AppErrorBoundary>
          <ToastOverlay />
          <ConfirmDialogOverlay />
          <AppAlertOverlay />
          <PearConsentOverlay />
          <PearPresentConsentOverlay />
          <ReceivedCardSheet
            visible={receivedCard !== null}
            card={receivedCard}
            verificationStatus={receivedVerification}
            source={receivedSource}
            sealedRoute={receivedSealedRoute}
            onSave={async (contact) => {
              await upsertContact(contact);
            }}
            onShowMine={() => {
              dismissReceived();
              router.replace(PRIMARY_TAB_HREFS.present);
            }}
            onDismiss={dismissReceived}
          />
          <VerifiedPageResultSheet />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
