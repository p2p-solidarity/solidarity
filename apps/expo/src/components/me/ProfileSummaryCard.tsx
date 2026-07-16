/**
 * ProfileSummaryCard — the new Profile Record (01-spec §3) surface inside
 * `VerifiedCard` (1.3.3 Task A2.2). Reads `@/profile/store` directly (this
 * is the "VerifiedCard 接真資料" wiring the task names) so `VerifiedCard`
 * doesn't have to prop-drill store state through `app/(tabs)/me/index.tsx`.
 *
 * Three honest states (CLAUDE.md rule 8 — no fake data):
 *   1. No root identity provisioned yet (`hasRootKey() === false`) — an
 *      honest "需要先完成身份設定" state with a CTA into the existing
 *      onboarding replay flow (`/onboarding?replay=1`, the same route
 *      `settings/index.tsx`'s "Replay Onboarding" row uses — that flow's
 *      non-skippable `BackupStep` is what actually provisions the root key
 *      via `createFromFreshMnemonic()`; this screen must never mint one
 *      itself — see `src/profile/store.ts`'s module doc).
 *   2. Root key exists but `status === 'empty'` (no Profile Record saved
 *      yet) — a "建立你的頁面" CTA into `/me/edit`.
 *   3. `status === 'ready'` — displayName/bio/links summary + an
 *      expandable QR for `https://solidarity.gg/#<fragment>`
 *      (`packages/shared`'s `encodeFragment`), with the oversize warning
 *      surfaced as a small non-blocking caption when the fragment exceeds
 *      the QR size budget.
 *
 * QR coexistence (do not merge with `QrShareCard`): the OLD exchange QR
 * (`buildRuntimeSolidarityQrWire`, `/share/qr`) stays wired exactly as
 * before via `QrShareCard` elsewhere in `VerifiedCard` — this component's
 * expandable QR is a SEPARATE surface for the new fragment-URL format only.
 * Task A2.3 wires the Verify-tab scanner that consumes it.
 *
 * The `hasRootKey()` check defaults optimistic (`true`) rather than
 * blocking first paint on it (CLAUDE.md rule 10): the overwhelming common
 * case is a root key already provisioned by onboarding's non-skippable
 * BackupStep, so most sessions never see the check flip anything. If the
 * async check later resolves `false`, the honest "needs setup" state
 * replaces whatever rendered first — a real state transition, not a
 * fabricated guess.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { generateQrPng } from '@/cards/qrCodeManager';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import { useProfileStore } from '@/profile/store';
import { encodeFragment } from '@solidarity/shared';

/** The Verified Page viewer's canonical URL — the fragment never leaves the
 * device over the network (01-spec §1/§8), so this is purely display text. */
const FRAGMENT_BASE_URL = 'https://solidarity.gg/#';

const QR_SIZE = 208;

export function ProfileSummaryCard() {
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const jws = useProfileStore((s) => s.jws);
  const status = useProfileStore((s) => s.status);

  const [rootKeyPresent, setRootKeyPresent] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void hasRootKey().then((has) => {
      if (!cancelled) setRootKeyPresent(has);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [expanded, setExpanded] = useState(false);
  const fragment = useMemo(() => (jws ? encodeFragment(jws) : null), [jws]);
  const fragmentUrl = fragment ? `${FRAGMENT_BASE_URL}${fragment.fragment}` : null;

  // Short-pointer URL (`#nostr:<npub>`), available ONLY once the profile has
  // been published to Nostr — `publishToNostr` writes the `nostr:npub…` entry
  // into `alsoKnownAs`, so its presence IS the "published" signal. It's far
  // shorter than the full offline blob (sparser QR too), but resolving it
  // needs a network round-trip, so it's offered ALONGSIDE the offline
  // fragment, never as a replacement (the app-vs-server short-link decision).
  const nostrAka = useMemo(
    () => record?.alsoKnownAs.find((a) => a.startsWith('nostr:npub')) ?? null,
    [record?.alsoKnownAs]
  );
  const shortUrl = nostrAka ? `${FRAGMENT_BASE_URL}${nostrAka}` : null;
  const [preferShort, setPreferShort] = useState(true);
  const useShort = preferShort && shortUrl !== null;
  const activeUrl = useShort ? shortUrl : fragmentUrl;

  const [qrImageUri, setQrImageUri] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!expanded || !activeUrl) {
      setQrImageUri(undefined);
      return;
    }
    let cancelled = false;
    void generateQrPng(activeUrl, { size: QR_SIZE }).then((uri) => {
      if (!cancelled) setQrImageUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, activeUrl]);

  if (!rootKeyPresent) {
    return (
      <View className="mx-4 gap-3 rounded-sm3 bg-mutedSurface px-3 pt-4 pb-6">
        <ThemedText variant="bodyMedium">{t('profileCard.needsIdentitySetup')}</ThemedText>
        <ThemedButton
          label={t('profileCard.setUpIdentity')}
          variant="primary"
          haptic="tap"
          onPress={() => {
            router.push('/onboarding?replay=1');
          }}
        />
      </View>
    );
  }

  if (status !== 'ready' || !record) {
    return (
      <View className="mx-4 gap-3 rounded-sm3 bg-mutedSurface px-3 pt-4 pb-6">
        <ThemedText variant="bodyMedium" tone="secondary">
          {t('profileCard.emptyHint')}
        </ThemedText>
        <ThemedButton
          label={t('profileCard.createPage')}
          variant="primary"
          haptic="tap"
          onPress={() => {
            router.push('/me/edit');
          }}
        />
      </View>
    );
  }

  return (
    <View className="mx-4 gap-3 rounded-sm3 bg-mutedSurface px-3 pt-4 pb-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text numberOfLines={1} className="text-text1 text-[17px] font-medium">
            {record.displayName}
          </Text>
          {record.bio.length > 0 ? (
            <Text numberOfLines={3} className="text-text2 text-[13px]">
              {record.bio}
            </Text>
          ) : null}
        </View>
        <PressableScale
          haptic="tap"
          onPress={() => {
            router.push('/me/edit');
          }}
          accessibilityRole="button"
          accessibilityLabel={t('profileCard.edit')}
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name="pencil" size={15} color={Colors.text2} />
        </PressableScale>
      </View>

      {record.links.length > 0 ? (
        <View className="gap-1">
          {record.links.map((link) => (
            <Text
              key={`${link.label}-${link.url}`}
              numberOfLines={1}
              className="text-text3 text-[12px]"
            >
              {link.label.length > 0 ? `${link.label} · ${link.url}` : link.url}
            </Text>
          ))}
        </View>
      ) : null}

      <ThemedButton
        label={expanded ? t('profileCard.hideQr') : t('profileCard.showQr')}
        variant="secondary"
        haptic="tap"
        onPress={() => {
          setExpanded((v) => !v);
        }}
      />

      {expanded ? (
        <View className="items-center gap-2 pt-1">
          {shortUrl ? (
            <>
              <View className="flex-row gap-2 self-stretch">
                <View style={{ flex: 1 }}>
                  <ThemedButton
                    label={t('profileCard.shortLink')}
                    variant={useShort ? 'primary' : 'secondary'}
                    haptic="tap"
                    fullWidth
                    onPress={() => {
                      setPreferShort(true);
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedButton
                    label={t('profileCard.offlineLink')}
                    variant={!useShort ? 'primary' : 'secondary'}
                    haptic="tap"
                    fullWidth
                    onPress={() => {
                      setPreferShort(false);
                    }}
                  />
                </View>
              </View>
              <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {t(useShort ? 'profileCard.shortLinkHint' : 'profileCard.offlineLinkHint')}
              </ThemedText>
            </>
          ) : null}
          {qrImageUri ? (
            <View
              style={{
                width: QR_SIZE,
                height: QR_SIZE,
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 2,
              }}
            >
              <Image
                source={{ uri: qrImageUri }}
                contentFit="contain"
                style={{ width: QR_SIZE - 16, height: QR_SIZE - 16 }}
              />
            </View>
          ) : (
            <View
              style={{ width: QR_SIZE, height: QR_SIZE, alignItems: 'center', justifyContent: 'center' }}
            >
              <ThemedText variant="caption" tone="secondary">
                {t('profileCard.generatingQr')}
              </ThemedText>
            </View>
          )}
          {fragment?.oversize ? (
            <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {t('profileCard.oversizeWarning')}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
