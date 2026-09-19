import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { PresentationSheet } from '@/components/credentials/PresentationSheet';
import { SfIcon } from '@/components/icons/SfIcon';
import { ROW_RADIUS } from '@/components/me/pageRowStyles';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import type { StoredCredential } from '@/credentials/store';
import { useTranslation } from '@/i18n';
import type { ProvableClaimEntity } from '@/identity';
import { hasPassportShowWitnessSafe } from '@/passport/showWitnessVault';
import type { PresentAttestationsState } from '@/present/presentModel';

interface CredentialClaimGroup {
  readonly credential: StoredCredential;
  readonly claims: readonly ProvableClaimEntity[];
}

export function PresentAttestationsMode({
  claims,
  credentials,
  state,
  onRetry,
}: {
  readonly claims: readonly ProvableClaimEntity[];
  readonly credentials: ReadonlyMap<string, StoredCredential>;
  readonly state: PresentAttestationsState;
  readonly onRetry: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupClaimsByCredential(claims, credentials),
    [claims, credentials]
  );
  // A witness-less passport can have every one of its claims dropped by the
  // claim-level device gate before reaching us, which resolves to `empty`.
  // Rendering "you have no attestations" there would be false — the user does
  // hold one; this device just cannot prove it. Say the true thing instead.
  // Both halves matter: tag WITHOUT witness. Testing the tag alone would also
  // fire when the emptiness has some other cause (a second legacy passport
  // gated out, a claim that failed to restore, a stale holder DID) and would
  // then state a reason that is false.
  const holdsUnpresentableOpenAcV3 = useMemo(
    () =>
      Array.from(credentials.values()).some(
        (credential) =>
          credential.metadataTags.includes('passport-openac-v3') &&
          !hasPassportShowWitnessSafe(credential.id)
      ),
    [credentials]
  );

  return (
    <View className="gap-3">
      {state === 'loading' ? (
        <ThemedSurface variant="outlined" padded className="items-center gap-3 rounded-none">
          <ActivityIndicator />
          <ThemedText variant="bodySmall" tone="tertiary">
            {t('present.loadingAttestations')}
          </ThemedText>
        </ThemedSurface>
      ) : null}
      {state === 'error' ? (
        <ThemedSurface variant="outlined" padded className="gap-3 rounded-none">
          <ThemedText variant="bodyMedium" tone="error">
            {t('present.attestationsLoadError')}
          </ThemedText>
          <ThemedButton label={t('present.retry')} variant="secondary" onPress={onRetry} />
        </ThemedSurface>
      ) : null}
      {state === 'empty' ? (
        holdsUnpresentableOpenAcV3 ? (
          <CannotPresentHerePanel />
        ) : (
          <ThemedSurface variant="outlined" padded className="gap-4 rounded-none">
            <ThemedText variant="bodyMedium" tone="tertiary">
              {t('present.noAttestations')}
            </ThemedText>
            <ThemedButton
              label={t('present.addAttestation')}
              variant="secondary"
              fullWidth
              onPress={() => {
                router.push('/passport');
              }}
            />
          </ThemedSurface>
        )
      ) : null}
      {state === 'ready'
        ? groups.map((group) => (
            <CredentialPresentation
              key={`${group.credential.id}:${group.claims.map((claim) => claim.id).join('|')}`}
              credential={group.credential}
              claims={group.claims}
            />
          ))
        : null}
    </View>
  );
}

function CredentialPresentation({
  credential,
  claims,
}: CredentialClaimGroup): ReactNode {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [selectedClaimIds, setSelectedClaimIds] = useState<ReadonlySet<string>>(
    () => defaultSelectedClaimIds(claims)
  );
  const [presenting, setPresenting] = useState(false);
  const labels: Readonly<Record<string, string>> = {
    is_human: t('present.claim.isHuman'),
    age_over_18: t('present.claim.ageOver18'),
    field_name: t('present.claim.name'),
    nationality: t('present.claim.nationality'),
  };
  // The credential is portable; the show-witness deliberately is not (it holds
  // the commitment opening). So an OpenAC-v3 credential can legitimately be
  // here with no way to prove itself FROM THIS DEVICE — fail closed and say
  // so, rather than falling through to a legacy envelope that proves none of
  // these claims.
  const isOpenAcV3 = credential.metadataTags.includes('passport-openac-v3');
  const passportShowEligible =
    isOpenAcV3 && hasPassportShowWitnessSafe(credential.id);
  const needsRescanOnThisDevice = isOpenAcV3 && !passportShowEligible;

  return (
    <View className="gap-3">
      <IdentityProofCard expiresAt={credential.expiresAt} />

      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {claims.map((claim) => {
          const selected = selectedClaimIds.has(claim.id);
          const label = labels[claim.claimType] ?? claim.title;
          // Nothing can be presented from here, so the chips are a read-only
          // summary of what the proof covers — offering a checkbox that leads
          // nowhere would be a dead affordance.
          return needsRescanOnThisDevice ? (
            <ReadOnlyClaimChip key={claim.id} label={label} />
          ) : (
            <ClaimChip
              key={claim.id}
              label={label}
              selected={selected}
              onPress={() => {
                setSelectedClaimIds((current) => {
                  const next = new Set(current);
                  if (next.has(claim.id)) next.delete(claim.id);
                  else next.add(claim.id);
                  return next;
                });
              }}
            />
          );
        })}
      </View>

      <ThemedSurface
        variant="outlined"
        padded
        className="items-center gap-3"
        style={{ borderColor: colors.divider }}
      >
        {needsRescanOnThisDevice ? (
          <CannotPresentHereContent />
        ) : (
          <>
            <SfIcon name="qrcode" size={42} color={Colors.text2} />
            <ThemedText variant="label" tabularNums>
              {t('present.presentCount', { count: selectedClaimIds.size })}
            </ThemedText>
            <ThemedButton
              fullWidth
              disabled={selectedClaimIds.size === 0}
              label={t('present.prepareProofQr')}
              onPress={() => {
                setPresenting(true);
              }}
            />
          </>
        )}
      </ThemedSurface>

      <PresentationSheet
        visible={presenting}
        credential={credential}
        selectedClaimIds={selectedClaimIds}
        passportShowEligible={passportShowEligible}
        productMode
        onDismiss={() => {
          setPresenting(false);
        }}
      />
    </View>
  );
}

function IdentityProofCard({
  expiresAt,
}: {
  readonly expiresAt: Date | undefined;
}): ReactNode {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const expiry = formatExpiry(expiresAt);
  return (
    <ThemedSurface variant="card" style={{ overflow: 'hidden' }}>
      <LinearGradient
        colors={[colors.chipSurface, colors.warmCream]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 16 }}
      >
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <SfIcon name="wallet.pass" size={17} color={Colors.primaryBlue} />
          <ThemedText variant="label" style={{ flex: 1 }}>
            {t('present.identityProof')}
          </ThemedText>
          {expiry === null ? null : (
            <ThemedText
              variant="caption"
              tone="secondary"
              tabularNums
              style={{ fontFamily: 'Menlo' }}
            >
              {t('present.expiry', { expiry })}
            </ThemedText>
          )}
        </View>
      </LinearGradient>
    </ThemedSurface>
  );
}

/** The panel's contents, shared by the per-credential branch and the
 *  all-claims-filtered-out `empty` branch — the same true statement either
 *  way: the proof is real, this device just holds no key material for it. */
function CannotPresentHereContent(): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <SfIcon name="exclamationmark.triangle" size={28} color={Colors.warning} />
      <ThemedText variant="label">{t('present.rescanRequired')}</ThemedText>
      <ThemedText
        variant="bodySmall"
        tone="tertiary"
        style={{ textAlign: 'center' }}
      >
        {t('present.rescanRequiredBody')}
      </ThemedText>
      <ThemedButton
        fullWidth
        variant="secondary"
        label={t('present.rescanAction')}
        onPress={() => {
          router.push('/passport');
        }}
      />
    </>
  );
}

function CannotPresentHerePanel(): ReactNode {
  const colors = useThemeColors();
  return (
    <ThemedSurface
      variant="outlined"
      padded
      className="items-center gap-3"
      style={{ borderColor: colors.divider }}
    >
      <CannotPresentHereContent />
    </ThemedSurface>
  );
}

function chipStyle(selected: boolean, dividerColor: string, cardBg: string) {
  return {
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderRadius: ROW_RADIUS,
    borderColor: selected ? Colors.terminalGreen : dividerColor,
    backgroundColor: selected ? Colors.terminalGreenBg : cardBg,
  };
}

/** Read-only variant: a plain View, not a disabled Pressable. A disabled
 *  Pressable is announced as "dimmed", which reads as a control that could be
 *  switched back on — but nothing here is presentable, so it is a label. */
function ReadOnlyClaimChip({ label }: { readonly label: string }): ReactNode {
  const colors = useThemeColors();
  return (
    <View accessible accessibilityRole="text" style={chipStyle(false, colors.divider, colors.cardBg)}>
      <ThemedText variant="bodySmall" style={{ color: colors.text2 }}>
        {label}
      </ThemedText>
    </View>
  );
}

function ClaimChip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const colors = useThemeColors();
  return (
    <PressableScale
      haptic="tap"
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={chipStyle(selected, colors.divider, colors.cardBg)}
    >
      <ThemedText
        variant="bodySmall"
        style={{ color: selected ? Colors.terminalGreenText : colors.text2 }}
      >
        {label}
      </ThemedText>
    </PressableScale>
  );
}

function defaultSelectedClaimIds(
  claims: readonly ProvableClaimEntity[]
): ReadonlySet<string> {
  return new Set(
    claims
      .filter(
        (claim) =>
          claim.claimType === 'is_human' || claim.claimType === 'age_over_18'
      )
      .map((claim) => claim.id)
  );
}

function groupClaimsByCredential(
  claims: readonly ProvableClaimEntity[],
  credentials: ReadonlyMap<string, StoredCredential>
): readonly CredentialClaimGroup[] {
  const grouped = new Map<string, ProvableClaimEntity[]>();
  for (const claim of claims) {
    const credential = credentials.get(claim.identityCardId);
    if (credential === undefined) continue;
    const existing = grouped.get(credential.id);
    if (existing === undefined) grouped.set(credential.id, [claim]);
    else existing.push(claim);
  }
  return Array.from(grouped).flatMap(([credentialId, groupedClaims]) => {
    const credential = credentials.get(credentialId);
    return credential === undefined ? [] : [{ credential, claims: groupedClaims }];
  });
}

function formatExpiry(value: Date | undefined): string | null {
  if (value === undefined || !Number.isFinite(value.getTime())) return null;
  return value.toISOString().slice(0, 7);
}
