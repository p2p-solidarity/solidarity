/**
 * View DIDs — originally a 1:1 port of the Swift DIDListSheet; 1.3.3 S7b
 * reshaped it around the two-key architecture (04-plan 方向決策 D1):
 *
 *   • ROOT IDENTITY (primary) — the seed-derived did:key from
 *     `identity/rootKey.ts`. Portable: the same mnemonic yields the same
 *     did on App and Web. This is the ONLY user-facing identity; profile,
 *     badges, Pear handshake and Nostr keys all hang off it.
 *   • CARD SIGNING KEY (secondary) — the hardware-backed (Secure Enclave /
 *     StrongBox) key that signs credentials, SD-JWTs and ZK device
 *     bindings. Hardware keys cannot be derived from a mnemonic, so it is
 *     NOT an identity: it is anchored to the root via the
 *     `solidarity.cardKeyBinding.v1` JWS (Phase A5b). Shown here so the
 *     anchor relationship is inspectable, never presented as "your DID".
 *
 * Root did loads async (no await before first paint — rule 10): the screen
 * paints with the signing-key card from the coordinator cache, and the root
 * section resolves in with a REAL absent-state when no root exists.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { useActiveDid, useIdentityCoordinator } from '@/identity';
import { getRootDid } from '@/identity/rootKey';

type RootDidState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'resolved'; readonly did: string | null };

export default function DIDListSheet() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ did?: string }>();
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  useEffect(() => {
    void seedKeychain();
  }, [seedKeychain]);
  const activeDid = useActiveDid();
  const displayDid = activeDid ?? params.did ?? null;

  // Root identity resolves async; loading → real did or honest absence.
  const [rootDid, setRootDid] = useState<RootDidState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void getRootDid().then((result) => {
      if (!cancelled) setRootDid({ kind: 'resolved', did: result.ok ? result.value : null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <SettingsBackToolbar
        title={t('dids.close')}
        onPress={() => {
          router.back();
        }}
      />
      <SettingsScreenTitle title={t('dids.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}>
        <View className="gap-6">
          {/* Root identity — the one portable did:key (D1) */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title={t('dids.rootIdentity')} />
            <View className="px-4 gap-2">
              {rootDid.kind === 'loading' ? null : rootDid.did ? (
                <DidCard did={rootDid.did} />
              ) : (
                <NoActiveDidCard label={t('dids.noRootIdentity')} />
              )}
              <ThemedText variant="caption" tone="tertiary" className="px-1">
                {t('dids.rootIdentityHint')}
              </ThemedText>
            </View>
          </View>

          {/* Card signing key — hardware-backed, anchored to the root (A5b) */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title={t('dids.cardSigningKey')} />
            <View className="px-4 gap-2">
              {displayDid ? (
                <DidCard did={displayDid} />
              ) : (
                <NoActiveDidCard label={t('dids.noActiveDid')} />
              )}
              <ThemedText variant="caption" tone="tertiary" className="px-1">
                {t('dids.cardSigningKeyHint')}
              </ThemedText>
            </View>
          </View>

          {/* Key Storage — platform-specific labels */}
          <SettingsBlockSection
            title={t('dids.keyStorage')}
            footer={
              Platform.OS === 'ios'
                ? t('dids.keyStorageFooter.ios')
                : t('dids.keyStorageFooter.android')
            }>
            <SettingsBlockInfoRow
              icon={Platform.OS === 'ios' ? 'key.icloud' : 'lock.shield'}
              title={t('dids.storage')}
              value={
                Platform.OS === 'ios' ? t('dids.storageValue.ios') : t('dids.storageValue.android')
              }
            />
            <SettingsBlockInfoRow
              icon="arrow.triangle.2.circlepath"
              title={t('dids.sync')}
              value={Platform.OS === 'ios' ? t('dids.syncValue.ios') : t('dids.syncValue.android')}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}

function DidCard({ did }: { did: string }) {
  const method = did.startsWith('did:key') ? 'did:key' : 'did:web';
  return (
    <ThemedSurface
      variant="inset"
      className="rounded-none"
      style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
      <View className="flex-row items-center" style={{ marginBottom: 8 }}>
        <View
          style={{
            width: 20,
            height: 20,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
          }}>
          <SfIcon name="key.horizontal" size={14} color={Colors.text1} />
        </View>
        <ThemedText variant="label" tone="secondary" style={{ fontFamily: 'Menlo' }}>
          {method.toUpperCase()}
        </ThemedText>
      </View>
      <ThemedText variant="caption" style={{ fontFamily: 'Menlo' }} numberOfLines={3} selectable>
        {did}
      </ThemedText>
    </ThemedSurface>
  );
}

function NoActiveDidCard({ label }: { label: string }) {
  return (
    <ThemedSurface
      variant="inset"
      className="flex-row items-center rounded-none"
      style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}>
        <SfIcon name="circle.dashed" size={14} color={Colors.text2} />
      </View>
      <ThemedText variant="bodyMedium" tone="secondary" style={{ flex: 1 }}>
        {label}
      </ThemedText>
    </ThemedSurface>
  );
}
