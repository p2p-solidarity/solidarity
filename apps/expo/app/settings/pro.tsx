import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsEnter,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';
import { useProEntitlementStore, useProStatus } from '@/pro/entitlementStore';
import {
  loadProYearlyProduct,
  purchaseProYearly,
  restoreProPurchases,
  type ProProductState,
  type ProPurchaseOutcome,
} from '@/pro/purchases';

type PriceState = { readonly kind: 'loading' } | ProProductState;

/** Where the store sends a subscriber to change or cancel their plan. */
const MANAGE_SUBSCRIPTION_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
  default: 'https://apps.apple.com/account/subscriptions',
});

const FREE_FEATURE_KEYS = [
  'pro.free.verification',
  'pro.free.monitoring',
  'pro.free.exchange',
  'pro.free.theme',
  'pro.free.domainIdentity',
] as const;

/**
 * Everything on this list works the moment the purchase clears. Nothing
 * aspirational belongs here: Apple rejects paywalls that sell absent features,
 * and a promise we cannot keep on day one is the wrong way to take money.
 */
const PRO_FEATURE_KEYS = [
  'pro.feature.sections',
  'pro.feature.style',
  'pro.feature.footer',
] as const;

export default function ProSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const status = useProStatus();
  const record = useProEntitlementStore((state) => state.record);
  const [busy, setBusy] = useState<'subscribe' | 'restore' | null>(null);
  const [price, setPrice] = useState<PriceState>({ kind: 'loading' });

  const isPro = status !== 'free';
  const displayPrice = price.kind === 'ready' ? price.displayPrice : null;

  const loadPrice = useCallback(async (isAlive: () => boolean = () => true): Promise<void> => {
    setPrice({ kind: 'loading' });
    const next = await loadProYearlyProduct();
    if (isAlive()) setPrice(next);
  }, []);

  useEffect(() => {
    let alive = true;
    void loadPrice(() => alive);
    return () => {
      alive = false;
    };
  }, [loadPrice]);

  const report = useCallback(
    (outcome: ProPurchaseOutcome, restoring: boolean): void => {
      switch (outcome.kind) {
        case 'purchased':
          haptic('success');
          pushToast(restoring ? t('pro.restored') : t('pro.active'), 'success');
          return;
        case 'cancelled':
          pushToast(t('pro.purchaseCancelled'), 'info');
          return;
        case 'pending':
          pushToast(t('pro.purchasePending'), 'info');
          return;
        case 'unavailable':
          if (outcome.reason === 'nothing-to-restore') {
            pushToast(t('pro.nothingToRestore'), 'info');
            return;
          }
          haptic('error');
          pushToast(t('pro.storeUnavailable'), 'error');
          return;
        case 'failed':
          haptic('error');
          pushToast(t('pro.purchaseFailed'), 'error');
      }
    },
    [t]
  );

  const subscribe = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy('subscribe');
    try {
      report(await purchaseProYearly(), false);
    } finally {
      setBusy(null);
    }
  }, [busy, report]);

  const restore = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy('restore');
    try {
      report(await restoreProPurchases(), true);
    } finally {
      setBusy(null);
    }
  }, [busy, report]);

  const renewalLine =
    record && status === 'pro'
      ? t('pro.activeUntil', {
          date: new Date(record.expiresAt).toLocaleDateString(),
        })
      : null;

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('pro.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 40 }}>
        <View className="gap-4">
          <SettingsEnter index={0}>
            <LinearGradient
              colors={[Colors.heroGradientStart, Colors.heroGradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 20, overflow: 'hidden', padding: 18 }}>
              <View className="flex-row items-center justify-between gap-3">
                <View className="gap-1">
                  <ThemedText variant="titleLarge">
                    {isPro ? t('pro.active') : t('pro.planName')}
                  </ThemedText>
                  {/* Apple requires the amount actually billed to be the most
                      prominent price on the screen — no per-month breakdown
                      competes with it here. */}
                  {renewalLine ? (
                    <ThemedText variant="titleMedium" tone="secondary">
                      {renewalLine}
                    </ThemedText>
                  ) : displayPrice ? (
                    <ThemedText variant="titleMedium" tone="secondary">
                      {t('pro.pricePerYear', { price: displayPrice })}
                    </ThemedText>
                  ) : price.kind === 'loading' ? (
                    <ActivityIndicator size="small" color={Colors.text3} style={{ alignSelf: 'flex-start' }} />
                  ) : (
                    <ThemedText variant="bodySmall" tone="secondary">
                      {t('pro.priceUnavailable')}
                    </ThemedText>
                  )}
                </View>
                <View
                  className="items-center justify-center rounded-full"
                  style={{ width: 44, height: 44, backgroundColor: Colors.cardSurface }}>
                  <SfIcon
                    name={isPro ? 'checkmark.seal.fill' : 'sparkles'}
                    size={19}
                    color={Colors.primaryMauve}
                  />
                </View>
              </View>
              <ThemedText variant="bodySmall" tone="secondary" className="pt-4">
                {t('pro.promise')}
              </ThemedText>
            </LinearGradient>
          </SettingsEnter>

          {status === 'grace' ? (
            <ThemedSurface variant="inset" className="flex-row items-start gap-2.5 rounded-xl px-4 py-3">
              <SfIcon name="wifi.slash" size={14} color={Colors.text3} />
              <ThemedText variant="caption" tone="secondary" style={{ flex: 1 }}>
                {t('pro.graceNotice')}
              </ThemedText>
            </ThemedSurface>
          ) : null}

          <SettingsEnter index={1}>
            <PlanCard title={t('pro.free')} featureKeys={FREE_FEATURE_KEYS} />
          </SettingsEnter>
          <SettingsEnter index={2}>
            <PlanCard
              title={t('pro.planName')}
              price={displayPrice ? t('pro.pricePerYear', { price: displayPrice }) : null}
              featureKeys={PRO_FEATURE_KEYS}
              featured
            />
          </SettingsEnter>

          {isPro ? (
            <ThemedButton
              label={t('pro.manage')}
              variant="secondary"
              fullWidth
              onPress={() => { void Linking.openURL(MANAGE_SUBSCRIPTION_URL); }}
            />
          ) : price.kind === 'unavailable' ? (
            <ThemedButton
              label={t('pro.retry')}
              variant="primary"
              fullWidth
              onPress={() => { void loadPrice(); }}
            />
          ) : (
            <ThemedButton
              label={displayPrice ? t('pro.subscribe', { price: displayPrice }) : t('pro.subscribeShort')}
              variant="primary"
              fullWidth
              loading={busy === 'subscribe' || price.kind === 'loading'}
              disabled={displayPrice === null}
              onPress={() => { void subscribe(); }}
            />
          )}

          {/* Mandatory for any auto-renewable subscription, and must keep
              working even for a user who already owns it on another device. */}
          <ThemedButton
            label={t('pro.restore')}
            variant="secondary"
            fullWidth
            loading={busy === 'restore'}
            onPress={() => { void restore(); }}
          />

          {/* The renewal terms need the real billed amount, so they appear once
              the store has told us what it is — which is also the only state in
              which Subscribe can be pressed. App Store auto-renew disclosure:
              shortened in the declutter pass, but it stays ON SCREEN next to
              the button — never behind an ⓘ. */}
          {displayPrice ? (
            <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
              {t('pro.autoRenew', { price: displayPrice })}
            </ThemedText>
          ) : null}

          <View className="flex-row items-center justify-center gap-6 pt-1">
            <LegalLink label={t('pro.terms')} onPress={() => { router.push('/legal/terms'); }} />
            <LegalLink label={t('pro.privacy')} onPress={() => { router.push('/legal/privacy'); }} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function LegalLink({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={{ minHeight: 44, justifyContent: 'center' }}>
      <ThemedText variant="caption" tone="secondary" style={{ textDecorationLine: 'underline' }}>
        {label}
      </ThemedText>
    </PressableScale>
  );
}

function PlanCard({
  title,
  price,
  featureKeys,
  featured = false,
}: {
  readonly title: string;
  readonly price?: string | null;
  readonly featureKeys: readonly string[];
  readonly featured?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ThemedSurface
      variant={featured ? 'outlined' : 'card'}
      className="gap-3 rounded-2xl p-4"
      style={featured ? { borderColor: Colors.primaryMauve, borderWidth: 1.5 } : undefined}>
      <View className="flex-row items-baseline justify-between gap-3">
        <ThemedText variant="titleMedium">{title}</ThemedText>
        {price ? (
          <ThemedText variant="label" tone={featured ? 'accent' : 'secondary'}>
            {price}
          </ThemedText>
        ) : null}
      </View>
      <View className="gap-2.5">
        {featureKeys.map((key) => (
          <View key={key} className="flex-row items-start gap-2.5">
            <SfIcon name="checkmark" size={12} color={Colors.terminalGreen} />
            <ThemedText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
              {t(key)}
            </ThemedText>
          </View>
        ))}
      </View>
    </ThemedSurface>
  );
}
