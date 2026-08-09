/**
 * Developer-only home for the former Verify tab. The verification,
 * credential-import and selective-disclosure mechanisms stay intact;
 * only their information architecture changes.
 */
import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import {
  DisclosureRowView,
  MeActionTile,
  MeSectionHeader,
  VerifiedCredentialRow,
} from '@/components/me';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedText } from '@/components/themed';
import { credentialTrustDisplayFor } from '@/credentials/trustDisplay';
import { STAGGER_MS } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import {
  useDisplayClaims,
  useIdentityData,
  type IdentityCardEntity,
  type ProvableClaimEntity,
} from '@/identity';

export interface VerificationToolsScreenProps {
  readonly onBack: () => void;
}

export function VerificationToolsScreen({
  onBack,
}: VerificationToolsScreenProps): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const identityCards = useIdentityData((s) => s.identityCards);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);

  useEffect(() => {
    void hydrateCards();
    void hydrateIdentity();
  }, [hydrateCards, hydrateIdentity]);

  const cardDetail = useMyCardDetail();
  const workContext = useMemo(() => {
    const ctx = cardDetail?.groupContext;
    if (ctx?.type === 'group') {
      return { groupId: ctx.info.groupId, groupName: ctx.info.groupName };
    }
    return null;
  }, [cardDetail?.groupContext]);

  const verifiedCreds = useMemo(
    () => identityCards.filter((c) => c.type !== 'business_card'),
    [identityCards]
  );
  const disclosures = useDisplayClaims();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={onBack} />
      <SettingsScreenTitle title={t('developer.verification.title')} />

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
        <View className="gap-8">
          <Animated.View entering={FadeInDown.duration(360)}>
            <ScanEntrySection onScan={() => { router.push('/scan'); }} />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS)}>
            <VerifiedCredentialsSection
              items={verifiedCreds}
              onScanIdentity={() => { router.push('/passport'); }}
              onManualInput={() => {
                router.push({ pathname: '/passport', params: { manual: '1' } });
              }}
              onImportJson={() => { router.push('/credentials'); }}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 2)}>
            <SelectiveDisclosuresSection claims={disclosures} workContext={workContext} />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 3)}>
            <ActionSection
              onAcquire={() => { router.push('/passport'); }}
              onImportRaw={() => { router.push('/credentials'); }}
            />
          </Animated.View>

        </View>
      </ScrollView>
    </View>
  );
}

function ScanEntrySection({ onScan }: { readonly onScan: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="px-4 gap-2">
      <MeActionTile icon="qrcode.viewfinder" title={t('verifyTab.scan')} onPress={onScan} />
      <ThemedText variant="caption" tone="tertiary" className="px-1">
        {t('verifyTab.scanSubtitle')}
      </ThemedText>
    </View>
  );
}

function VerifiedCredentialsSection({
  items,
  onScanIdentity,
  onManualInput,
  onImportJson,
}: {
  readonly items: readonly IdentityCardEntity[];
  readonly onScanIdentity: () => void;
  readonly onManualInput: () => void;
  readonly onImportJson: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <MeSectionHeader title={t('meTab.verifiedCredentials')} />
      {items.length === 0 ? (
        <View className="px-4 gap-2">
          <View className="flex-row gap-2">
            <MeActionTile icon="viewfinder" title={t('meTab.scanIdentity')} onPress={onScanIdentity} />
            <MeActionTile icon="keyboard" title={t('meTab.manualInput')} onPress={onManualInput} />
          </View>
          <MeActionTile
            icon="square.and.arrow.up"
            title={t('meTab.importJson')}
            onPress={onImportJson}
          />
        </View>
      ) : (
        <View className="gap-2">
          {items.map((c) => (
            <VerifiedCredentialRow
              key={c.id}
              icon={credentialIcon(c.type)}
              title={c.title}
              trustLevel={credentialTrustDisplayFor(c).level}
              issuerType={c.issuerDid.startsWith('did:') ? (c.issuerDid.split(':')[1] ?? 'unknown') : 'unknown'}
              onPress={() => {
                router.push({ pathname: '/credentials/[id]', params: { id: c.id } });
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function SelectiveDisclosuresSection({
  claims,
  workContext,
}: {
  readonly claims: readonly ProvableClaimEntity[];
  readonly workContext: { readonly groupId: string; readonly groupName: string } | null;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <MeSectionHeader title={t('meTab.selectiveDisclosures')} />
      {claims.length === 0 ? (
        <View className="px-4">
          <ThemedText variant="caption" tone="tertiary">
            {t('meTab.noDerivations')}
          </ThemedText>
        </View>
      ) : (
        <View className="gap-2">
          {claims.map((c) => {
            const canPresentInWork = workContext !== null && c.claimType === 'profile_card';
            return (
              <DisclosureRowView
                key={c.id}
                icon={claimIcon(c.claimType)}
                title={c.title}
                source={`Src:${capitalize(c.source)}`}
                actionTitle={t('meTab.show')}
                onPresent={() => {
                  router.push({
                    pathname: '/credentials/[id]',
                    params: { id: c.identityCardId, claimId: c.id },
                  });
                }}
                work={
                  canPresentInWork
                    ? {
                        title: t('meTab.work'),
                        accessibilityLabel: t('meTab.workAccessibility', {
                          group: workContext.groupName,
                        }),
                        onPress: () => {
                          router.push({
                            pathname: '/credentials/[id]',
                            params: {
                              id: c.identityCardId,
                              claimId: c.id,
                              context: 'work',
                              groupId: workContext.groupId,
                            },
                          });
                        },
                      }
                    : undefined
                }
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

function claimIcon(claimType: string): SFSymbol {
  switch (claimType) {
    case 'is_human': return 'faceid';
    case 'age_over_18': return 'face.smiling';
    case 'profile_card': return 'person.crop.rectangle.fill';
    case 'field_name': return 'person.fill';
    default: return 'checkmark.shield.fill';
  }
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ActionSection({
  onAcquire,
  onImportRaw,
}: {
  readonly onAcquire: () => void;
  readonly onImportRaw: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <MeSectionHeader title={t('meTab.action')} />
      <View className="px-4 flex-row gap-2">
        <MeActionTile icon="plus" title={t('meTab.acquireNewProof')} onPress={onAcquire} />
        <MeActionTile
          icon="square.and.arrow.up"
          title={t('meTab.importRawCredential')}
          onPress={onImportRaw}
        />
      </View>
    </View>
  );
}

function credentialIcon(type: string): SFSymbol {
  switch (type) {
    case 'passport': return 'doc.text.fill';
    case 'student': return 'graduationcap.fill';
    case 'social_graph':
    case 'socialGraph':
      return 'person.2.fill';
    default: return 'checkmark.shield.fill';
  }
}
