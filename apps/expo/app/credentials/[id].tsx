/**
 * Credential detail — port of solidarity/Views/MeViews/CredentialDetailView.swift.
 *
 * Layout (Swift parity, Figma 724:22805 / 22828 / 22844):
 *   • Hero: 56pt heroSky disc with type icon, 24pt medium title, level tag
 *     (uppercased), Verified + proof-system chips. Background is a sky
 *     gradient.
 *   • Metadata section ("Credential metadata"): 5 joined mutedSurface rows
 *     (Issuer / Holder / Issued / Expires / Proof).
 *   • Selective Disclosures section ("Selective Disclosures"): list of
 *     claim rows with checkbox. Empty state: "No claims associated with
 *     this credential."
 *   • Bottom bar: "Present proof" primary (disabled if no claims),
 *     "Regenerate Credential" secondary text button.
 *
 * Selective Disclosures are sourced from `useIdentityData.provableClaims`
 * filtered by this credential's id — mirrors Swift `associatedClaims`.
 */
import { router, useLocalSearchParams } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IssuerBadge } from '@/components/credentials/IssuerBadge';
import { PresentationSheet } from '@/components/credentials/PresentationSheet';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  useIssuerMetadataStore,
} from '@/credentials/issuerStore';
import {
  useCredentialById,
  useCredentialStore,
  type StoredCredential,
} from '@/credentials/store';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  useIdentityData,
  type ProvableClaimEntity,
} from '@/identity';

// MARK: - Helpers (Swift parity)

function shortDid(did: string): string {
  if (did.length <= 22) return did;
  return `${did.slice(0, 12)}...${did.slice(-8)}`;
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function credentialIcon(type: string): SFSymbol {
  switch (type) {
    case 'passport':
      return 'doc.text.fill';
    case 'student':
      return 'graduationcap.fill';
    case 'social_graph':
    case 'socialGraph':
      return 'person.2.fill';
    default:
      return 'checkmark.shield.fill';
  }
}

function proofTagText(metadataTags: readonly string[]): string {
  if (metadataTags.includes('mopro-noir')) return 'OpenPassport';
  if (metadataTags.includes('semaphore-zk')) return 'Semaphore ZK';
  return 'SD-JWT Fallback';
}

function proofTypeText(metadataTags: readonly string[]): string {
  if (metadataTags.includes('mopro-noir')) return 'OpenPassport (Noir/Mopro)';
  if (metadataTags.includes('semaphore-zk')) return 'Semaphore ZK';
  return 'SD-JWT Fallback';
}

function proofIcon(metadataTags: readonly string[]): SFSymbol {
  if (metadataTags.includes('mopro-noir')) return 'bolt.shield.fill';
  if (metadataTags.includes('semaphore-zk')) return 'shield.checkered';
  return 'doc.text.fill';
}

function levelText(
  trustLevel: StoredCredential['trustLevel'],
  t: (key: string) => string,
): string {
  switch (trustLevel) {
    case 'L3':
      return t('credentialDetail.levelL3');
    case 'L2':
      return t('credentialDetail.levelL2');
    default:
      return t('credentialDetail.levelL1');
  }
}

function levelAccent(trustLevel: StoredCredential['trustLevel']): string {
  switch (trustLevel) {
    case 'L3':
      return Colors.terminalGreen;
    case 'L2':
      return Colors.primaryBlue;
    default:
      return Colors.text3;
  }
}

/**
 * Issuer-trust badge (Figma hero "Verified" chip, 724:22818). Derived from
 * REAL credential fields — the issuer DID prefix plus trust level — never a
 * fabricated label:
 *   • `did:gov…` issuer (a passport read off a real chip via NFC) → the
 *     name is attested by the issuing authority → "Verified by passport".
 *   • everything else (self-issued `did:self…`, SD-JWT fallback, L1) →
 *     "Self-attested".
 * Returns `null` when the credential carries no signal we can stand behind,
 * so the chip is simply omitted rather than guessing (CLAUDE.md rule 8).
 */
function issuerTrustBadge(
  credential: StoredCredential,
  t: (key: string) => string,
): { text: string; icon: SFSymbol } | null {
  const isGovernment =
    credential.issuerDid.startsWith('did:gov') && credential.trustLevel !== 'L1';
  if (isGovernment) {
    return {
      text: t('credentialDetail.verifiedByPassport'),
      icon: 'checkmark.seal',
    };
  }
  const isSelfIssued =
    credential.issuerDid.startsWith('did:self') ||
    credential.issuerDid.startsWith('did:key') ||
    credential.trustLevel === 'L1';
  if (isSelfIssued) {
    return {
      text: t('credentialDetail.selfAttested'),
      icon: 'person.crop.circle',
    };
  }
  return null;
}

// MARK: - Sub-views

type RowPosition = 'first' | 'middle' | 'last';

interface MetadataRowProps {
  readonly label: string;
  readonly value: string;
  readonly position: RowPosition;
}

function MetadataRow({ label, value, position }: MetadataRowProps) {
  const borderRadius =
    position === 'first'
      ? { borderTopLeftRadius: 8, borderTopRightRadius: 8 }
      : position === 'last'
        ? { borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }
        : {};
  return (
    <View
      style={{
        height: 48,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.mutedSurface,
        ...borderRadius,
      }}
    >
      <Text className="text-text2 text-[15px]">{label}</Text>
      <View className="flex-1" />
      <Text
        className="text-text1 text-[15px]"
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{ maxWidth: '60%' }}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { readonly title: string }) {
  return (
    <View className="px-4">
      <Text className="text-text1 text-[14px]">{title}</Text>
    </View>
  );
}

function LevelTag({
  text,
  accent,
}: {
  readonly text: string;
  readonly accent: string;
}) {
  return (
    <View
      style={{
        borderWidth: 0.5,
        borderColor: accent,
        borderRadius: 2,
        paddingHorizontal: 4,
        paddingVertical: 2,
        alignItems: 'center',
        alignSelf: 'stretch',
      }}
    >
      <Text
        style={{ color: accent, fontSize: 10, fontWeight: '500' }}
      >
        {text.toUpperCase()}
      </Text>
    </View>
  );
}

interface ChipProps {
  readonly icon: SFSymbol;
  readonly text: string;
}

function Chip({ icon, text }: ChipProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: Colors.chipSurface,
        borderRadius: 2,
        paddingHorizontal: 4,
        paddingVertical: 2,
      }}
    >
      <View
        style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}
      >
        <SfIcon name={icon} size={9} color={Colors.text2} />
      </View>
      <Text className="text-text2 text-[10px]">{text}</Text>
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

function ClaimRow({
  claim,
  selected,
  onToggle,
}: {
  readonly claim: ProvableClaimEntity;
  readonly selected: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 10,
      }}
    >
      <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name={claimIcon(claim.claimType)} size={14} color={Colors.terminalGreen} />
      </View>
      <Text className="text-text1 text-[15px]" style={{ flex: 1 }}>
        {claim.title}
      </Text>
      {/* Selective-disclosure checkbox (Figma 724:22852 / 724:22864):
          18×18 rounded-2 box — terminalGreen filled + white check when
          included, grey-bordered + hollow when excluded. */}
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? Colors.terminalGreen : 'transparent',
          borderWidth: selected ? 0 : 1,
          borderColor: Colors.text3,
        }}
      >
        {selected ? (
          <SfIcon name="checkmark" size={11} weight="bold" color="#FFFFFF" />
        ) : null}
      </View>
    </Pressable>
  );
}

// MARK: - Screen

export default function CredentialDetailScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, context, groupId } = useLocalSearchParams<{
    id: string;
    /** 'work' when launched from the Me "Work" action — scopes the
     *  presentation to the group identified by `groupId`. */
    context?: string;
    groupId?: string;
  }>();
  const isWorkContext = context === 'work' && typeof groupId === 'string' && groupId.length > 0;
  const credential = useCredentialById(id);
  const manifestEntry = useCredentialStore((s) =>
    id ? s.manifest.find((m) => m.id === id) : undefined,
  );
  const remove = useCredentialStore((s) => s.remove);
  const loadDetail = useCredentialStore((s) => s.loadDetail);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);
  const hydrateIssuers = useIssuerMetadataStore((s) => s.hydrate);
  const allClaims = useIdentityData((s) => s.provableClaims);
  const markPresented = useIdentityData((s) => s.markClaimPresented);
  const [selectedClaimIDs, setSelectedClaimIDs] = useState<ReadonlySet<string>>(new Set());
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    void hydrateIdentity();
    void hydrateIssuers();
    if (id) void loadDetail(id);
  }, [hydrateIdentity, hydrateIssuers, loadDetail, id]);

  const associatedClaims = useMemo<readonly ProvableClaimEntity[]>(() => {
    if (!credential) return [];
    return allClaims.filter((c) => c.identityCardId === credential.id);
  }, [allClaims, credential]);

  const status = useMemo<string>(() => {
    if (!credential) return '';
    if (credential.expiresAt && credential.expiresAt.getTime() < Date.now()) {
      return t('credentialDetail.statusExpired');
    }
    return t('credentialDetail.statusValid');
  }, [credential, t]);

  if (!credential) {
    // Frame-1 render path: the manifest entry seeds the title before
    // `loadDetail(id)` resolves, so we never show "not found" until we
    // also have no manifest hit.
    return (
      <View className="flex-1 bg-pageBg items-center justify-center">
        <Text className="text-text2 text-[15px]">
          {manifestEntry ? t('credentialDetail.loading') : t('credentialDetail.notFound')}
        </Text>
      </View>
    );
  }

  const accent = levelAccent(credential.trustLevel);
  const trustBadge = issuerTrustBadge(credential, t);
  const isExpired =
    credential.expiresAt != null && credential.expiresAt.getTime() < Date.now();
  const presentDisabled = selectedClaimIDs.size === 0;

  const onPresent = () => {
    // TODO(biometric-gate): wrap in
    //   const gate = await requireSensitiveAction(
    //     'presentProof', 'Authenticate to present a proof.'
    //   );
    //   if (!gate.success) { pushToast(...); return; }
    // so credential presentation obeys the SensitiveAction policy. See
    // `src/keychain/biometricGatekeeper.ts`. The actual VP-token build
    // happens inside `PresentationSheet`, which already calls `signJwt`
    // (which is itself biometric-gated), so this is defence-in-depth.
    for (const claimID of selectedClaimIDs) {
      markPresented(claimID);
    }
    setPresenting(true);
  };

  const toggleClaim = (claimID: string) => {
    setSelectedClaimIDs((prev) => {
      const next = new Set(prev);
      if (next.has(claimID)) next.delete(claimID);
      else next.add(claimID);
      return next;
    });
  };

  const onRegenerate = () => {
    void (async () => {
      await remove(credential.id);
      pushToast(t('credentialDetail.removedToast'), 'success');
      router.back();
    })();
  };

  return (
    <View className="flex-1 bg-pageBg">
      {/* Navigation bar */}
      <View style={{ paddingTop: insets.top }} className="bg-pageBg">
        <View className="h-11 flex-row items-center px-4">
          <Pressable
            onPress={() => { router.back(); }}
            accessibilityRole="button"
            accessibilityLabel={t('credentialDetail.back')}
            className="flex-row items-center gap-1 -ml-1 px-1 py-1 active:opacity-60"
          >
            <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="text-text1 text-[17px] font-semibold">{t('credentialDetail.title')}</Text>
          </View>
          <View style={{ width: 24 }} />
        </View>
      </View>

      <ScrollView className="flex-1">
        <View className="gap-8 pt-3 pb-6">
          {/* Work-context banner — only when launched from the Me "Work"
              action with a real group id. Signals the presentation is scoped
              to that group rather than the personal context. */}
          {isWorkContext ? (
            <View
              className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-3"
            >
              <SfIcon name="briefcase" size={14} color={Colors.terminalGreen} />
              <Text className="text-text2 text-[13px] flex-1">
                {t('credentialDetail.workContextBanner')}
              </Text>
            </View>
          ) : null}

          {/* Hero */}
          <View className="mx-4 overflow-hidden rounded">
            <LinearGradient
              colors={[Colors.chipSurface, Colors.featuredCardBg]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{
                paddingHorizontal: 12,
                paddingTop: 16,
                paddingBottom: 24,
                alignItems: 'center',
                gap: 8,
                borderRadius: 4,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: Colors.warmCream,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SfIcon
                  name={credentialIcon(credential.type)}
                  size={22}
                  color={Colors.text1}
                />
              </View>

              <View style={{ alignItems: 'center', gap: 16, alignSelf: 'stretch' }}>
                <Text className="text-text1" style={{ fontSize: 24, fontWeight: '500' }}>
                  {credential.title}
                </Text>

                <IssuerBadge
                  issuerId={credential.issuerDid}
                  fallbackName={credential.issuerDid}
                />

                <View style={{ alignSelf: 'stretch', gap: 8 }}>
                  <LevelTag text={levelText(credential.trustLevel, t)} accent={accent} />
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 16,
                      justifyContent: 'center',
                    }}
                  >
                    {/* Issuer-trust badge (Figma "Verified" chip) — derived
                        from real issuer DID + trust level. Falls back to the
                        validity status only when no trust signal exists, and
                        always surfaces an expired warning. */}
                    {trustBadge ? (
                      <Chip icon={trustBadge.icon} text={trustBadge.text} />
                    ) : (
                      <Chip icon="checkmark.seal" text={status} />
                    )}
                    {isExpired && trustBadge ? (
                      <Chip icon="exclamationmark.triangle" text={status} />
                    ) : null}
                    <Chip
                      icon={proofIcon(credential.metadataTags)}
                      text={proofTagText(credential.metadataTags)}
                    />
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* Metadata section */}
          <View className="gap-2">
            <SectionHeader title={t('credentialDetail.metadataHeader')} />
            <View className="px-4">
              <MetadataRow
                label={t('credentialDetail.issuer')}
                value={credential.issuerDid}
                position="first"
              />
              <MetadataRow
                label={t('credentialDetail.holder')}
                value={shortDid(credential.holderDid)}
                position="middle"
              />
              <MetadataRow
                label={t('credentialDetail.issued')}
                value={formatDate(credential.issuedAt)}
                position="middle"
              />
              <MetadataRow
                label={t('credentialDetail.expires')}
                value={credential.expiresAt ? formatDate(credential.expiresAt) : t('credentialDetail.expiresNone')}
                position="middle"
              />
              <MetadataRow
                label={t('credentialDetail.proof')}
                value={proofTypeText(credential.metadataTags)}
                position="last"
              />
            </View>
          </View>

          {/* Selective Disclosures section */}
          <View className="gap-2">
            <SectionHeader title={t('credentialDetail.disclosuresHeader')} />
            {associatedClaims.length === 0 ? (
              <View className="px-4">
                <Text className="text-text3 text-[13px]">
                  {t('credentialDetail.noClaims')}
                </Text>
              </View>
            ) : (
              <View className="px-4" style={{ gap: 8 }}>
                {associatedClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    claim={c}
                    selected={selectedClaimIDs.has(c.id)}
                    onToggle={() => { toggleClaim(c.id); }}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Present bar */}
      <View
        className="bg-pageBg px-4 pt-3"
        style={{ paddingBottom: 12 + insets.bottom }}
      >
        <ThemedButton
          label={t('credentialDetail.presentProof')}
          fullWidth
          disabled={presentDisabled}
          onPress={onPresent}
        />
        <View className="mt-2 items-center">
          <Pressable
            onPress={onRegenerate}
            accessibilityRole="button"
            accessibilityLabel={t('credentialDetail.regenerate')}
            className="px-2 py-2 active:opacity-60"
          >
            <Text
              className="text-text2"
              style={{ fontSize: 12, fontWeight: '500' }}
            >
              {t('credentialDetail.regenerate')}
            </Text>
          </Pressable>
        </View>
      </View>

      <PresentationSheet
        visible={presenting}
        credentialId={credential.id}
        credentialTitle={credential.title}
        selectedClaimIds={selectedClaimIDs}
        onDismiss={() => { setPresenting(false); }}
      />
    </View>
  );
}
