/**
 * Share Settings — 1:1 port of
 * solidarity/Views/SharingViews/ShareSettingsView.swift.
 *
 * Top-of-screen QR PREVIEW that live-updates as toggles change, followed
 * by a SHARE FIELDS grid (Name locked, Title/Company/Email/Phone/Profile
 * Image/Social Networks/Skills) where every row carries a VC status
 * label when on. Legend below explains the colour code. PROOFS section
 * (Real Human + Age 18+) only renders when the corresponding provable
 * claims exist in `useIdentityData.provableClaims`.
 */
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import {
  type FieldDescriptor,
  FieldRow,
  LegendItem,
  ProofRow,
} from '@/components/settings/ShareSettingsRows';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import { shareFieldPreferencesFromFields } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrPayload } from '@/cards/solidarityQrRuntime';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import {
  useActiveDid,
  useHasClaim,
  useIdentityData,
  useIdentityCoordinator,
  useVerifiedFields,
} from '@/identity';
import { usePreferences } from '@/settings/preferences';
import type { BusinessCardField } from '@solidarity/shared';

/**
 * Field rows carry an i18n `labelKey` instead of a literal label; the
 * displayed `FieldDescriptor.label` is filled in at render via `t()` so the
 * shared `FieldRow` component stays untouched.
 */
const FIELD_ROWS: readonly (Omit<FieldDescriptor, 'label'> & { labelKey: string })[] = [
  { key: 'name', icon: 'person.text.rectangle', labelKey: 'shareSettings.field.name', locked: true },
  { key: 'title', icon: 'briefcase', labelKey: 'shareSettings.field.title' },
  { key: 'company', icon: 'building.2', labelKey: 'shareSettings.field.company' },
  { key: 'email', icon: 'envelope', labelKey: 'shareSettings.field.email' },
  { key: 'phone', icon: 'phone', labelKey: 'shareSettings.field.phone' },
  {
    key: 'profileImage',
    icon: 'person.crop.circle',
    labelKey: 'shareSettings.field.profileImage',
    excludedFromVc: true,
  },
  { key: 'socialNetworks', icon: 'link', labelKey: 'shareSettings.field.socialNetworks' },
  { key: 'skills', icon: 'star', labelKey: 'shareSettings.field.skills', excludedFromVc: true },
];

export default function ShareSettings(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const myCard = useMyCardDetail();
  const hydrateCards = useCardStore((s) => s.hydrate);
  useEffect(() => { void hydrateCards(); }, [hydrateCards]);
  const prefs = usePreferences();
  const enforceMandatory = usePreferences((s) => s.set);
  const [qrPayload, setQrPayload] = useState<string | null>(null);

  const hydrateIdentity = useIdentityData((s) => s.hydrate);
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  useEffect(() => {
    void hydrateIdentity();
    void seedKeychain();
  }, [hydrateIdentity, seedKeychain]);
  const activeDid = useActiveDid();
  const verifiedFields = useVerifiedFields(activeDid);

  const hasHumanClaim = useHasClaim('is_human', activeDid ?? undefined);
  const hasAgeClaim = useHasClaim('age_over_18', activeDid ?? undefined);
  const selectedProofClaims = useMemo<readonly string[]>(() => {
    const out: string[] = [];
    if (hasHumanClaim && prefs.shareIsHuman) out.push('is_human');
    if (hasAgeClaim && prefs.shareAgeOver18) out.push('age_over_18');
    return out;
  }, [hasAgeClaim, hasHumanClaim, prefs.shareAgeOver18, prefs.shareIsHuman]);
  useEffect(() => {
    if (hasHumanClaim && !prefs.shareIsHuman) {
      enforceMandatory('shareIsHuman', true);
    }
  }, [enforceMandatory, hasHumanClaim, prefs.shareIsHuman]);

  const enabled = useMemo<readonly BusinessCardField[]>(() => {
    const out: BusinessCardField[] = ['name'];
    if (prefs.shareTitle) out.push('title');
    if (prefs.shareCompany) out.push('company');
    if (prefs.shareEmail) out.push('email');
    if (prefs.sharePhone) out.push('phone');
    if (prefs.shareProfileImage) out.push('profileImage');
    if (prefs.shareSocialNetworks) out.push('socialNetworks');
    if (prefs.shareSkills) out.push('skills');
    return out;
  }, [
    prefs.shareCompany,
    prefs.shareEmail,
    prefs.sharePhone,
    prefs.shareProfileImage,
    prefs.shareSkills,
    prefs.shareSocialNetworks,
    prefs.shareTitle,
  ]);

  useEffect(() => {
    if (!myCard) {
      setQrPayload(null);
      return;
    }

    let cancelled = false;
    setQrPayload(null);
    void buildRuntimeSolidarityQrPayload(
      myCard,
      shareFieldPreferencesFromFields(enabled),
      { proofClaims: selectedProofClaims }
    ).then((next) => {
      if (!cancelled) setQrPayload(next);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, myCard, selectedProofClaims]);

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top }}
    >
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('shareSettings.title')} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        <QrPreview payload={qrPayload} t={t} />
        <FieldToggles prefs={prefs} verifiedFields={verifiedFields} t={t} />
        {hasHumanClaim || hasAgeClaim ? (
          <ProofToggles
            t={t}
            hasHumanClaim={hasHumanClaim}
            hasAgeClaim={hasAgeClaim}
            shareIsHuman={prefs.shareIsHuman}
            shareAgeOver18={prefs.shareAgeOver18}
            setShareIsHuman={(v) => { prefs.set('shareIsHuman', v); }}
            setShareAgeOver18={(v) => { prefs.set('shareAgeOver18', v); }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function QrPreview({
  payload,
  t,
}: {
  readonly payload: string | null;
  readonly t: (key: string) => string;
}): ReactNode {
  // Figma 726:23661 — the QR sits directly inside a searchBg-grey rounded
  // card (no white inner box, no border, no "QR PREVIEW" caption). The QR's
  // own white module background supplies the scannable quiet-zone.
  return (
    <View
      style={{
        padding: 32,
        backgroundColor: Colors.searchBg,
        borderRadius: 2,
        aspectRatio: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {payload ? (
        <QRCode
          value={payload}
          size={220}
          backgroundColor="#FFFFFF"
          color="#000000"
        />
      ) : (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <SfIcon name="qrcode" size={40} color={Colors.text3} />
          <ThemedText
            variant="caption"
            tone="tertiary"
            style={{ fontFamily: 'Menlo' }}
          >
            {t('shareSettings.createCardFirst')}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function FieldToggles({
  prefs,
  verifiedFields,
  t,
}: {
  readonly prefs: ReturnType<typeof usePreferences.getState>;
  readonly verifiedFields: ReadonlySet<BusinessCardField>;
  readonly t: (key: string) => string;
}): ReactNode {
  return (
    <View>
      <View
        className="flex-row items-center justify-between"
        style={{ paddingBottom: 8 }}
      >
        <ThemedText
          variant="caption"
          tone="tertiary"
          style={{ fontFamily: 'Menlo', fontWeight: '700' }}
        >
          {t('shareSettings.shareFields')}
        </ThemedText>
        <ThemedText
          tone="tertiary"
          style={{ fontFamily: 'Menlo', fontSize: 10 }}
        >
          {t('shareSettings.vcLegendHint')}
        </ThemedText>
      </View>

      <View
        style={{
          gap: 1,
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      >
        {FIELD_ROWS.map((row) => {
          const { labelKey, ...rest } = row;
          return (
            <FieldRow
              key={row.key}
              descriptor={{ ...rest, label: t(labelKey) }}
              isOn={isFieldOn(row.key, prefs)}
              verifiedFields={verifiedFields}
              onToggle={() => {
                if (row.locked) return;
                haptic('selection');
                toggleField(row.key, prefs);
              }}
            />
          );
        })}
      </View>

      <View
        className="flex-row items-center"
        style={{ gap: 16, paddingTop: 8 }}
      >
        <LegendItem color={Colors.terminalGreen} label={t('shareSettings.legend.verified')} />
        <LegendItem color={Colors.warning} label={t('shareSettings.legend.selfAttested')} />
        <LegendItem color={Colors.text3} label={t('shareSettings.legend.notInVc')} />
      </View>
    </View>
  );
}

function ProofToggles({
  t,
  hasHumanClaim,
  hasAgeClaim,
  shareIsHuman,
  shareAgeOver18,
  setShareIsHuman,
  setShareAgeOver18,
}: {
  readonly t: (key: string) => string;
  readonly hasHumanClaim: boolean;
  readonly hasAgeClaim: boolean;
  readonly shareIsHuman: boolean;
  readonly shareAgeOver18: boolean;
  readonly setShareIsHuman: (next: boolean) => void;
  readonly setShareAgeOver18: (next: boolean) => void;
}): ReactNode {
  return (
    <View>
      <ThemedText
        variant="caption"
        tone="tertiary"
        style={{ fontFamily: 'Menlo', fontWeight: '700', paddingBottom: 8 }}
      >
        {t('shareSettings.proofs')}
      </ThemedText>
      <View
        style={{
          gap: 1,
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      >
        {hasHumanClaim ? (
          <ProofRow
            icon="person.badge.shield.checkmark.fill"
            label={t('shareSettings.proof.realHuman')}
            badge={t('shareSettings.proof.government')}
            badgeColor={Colors.terminalGreen}
            isOn={shareIsHuman}
            locked
            onToggle={() => {
              haptic('selection');
              setShareIsHuman(!shareIsHuman);
            }}
          />
        ) : null}
        {hasAgeClaim ? (
          <ProofRow
            icon="calendar.badge.checkmark"
            label={t('shareSettings.proof.ageOver18')}
            badge={t('shareSettings.proof.government')}
            badgeColor={Colors.terminalGreen}
            isOn={shareAgeOver18}
            onToggle={() => {
              haptic('selection');
              setShareAgeOver18(!shareAgeOver18);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function isFieldOn(
  field: BusinessCardField,
  prefs: ReturnType<typeof usePreferences.getState>
): boolean {
  switch (field) {
    case 'name':
      return true;
    case 'title':
      return prefs.shareTitle;
    case 'company':
      return prefs.shareCompany;
    case 'email':
      return prefs.shareEmail;
    case 'phone':
      return prefs.sharePhone;
    case 'profileImage':
      return prefs.shareProfileImage;
    case 'socialNetworks':
      return prefs.shareSocialNetworks;
    case 'skills':
      return prefs.shareSkills;
  }
}

function toggleField(
  field: BusinessCardField,
  prefs: ReturnType<typeof usePreferences.getState>
): void {
  switch (field) {
    case 'title':
      prefs.set('shareTitle', !prefs.shareTitle);
      return;
    case 'company':
      prefs.set('shareCompany', !prefs.shareCompany);
      return;
    case 'email':
      prefs.set('shareEmail', !prefs.shareEmail);
      return;
    case 'phone':
      prefs.set('sharePhone', !prefs.sharePhone);
      return;
    case 'profileImage':
      prefs.set('shareProfileImage', !prefs.shareProfileImage);
      return;
    case 'socialNetworks':
      prefs.set('shareSocialNetworks', !prefs.shareSocialNetworks);
      return;
    case 'skills':
      prefs.set('shareSkills', !prefs.shareSkills);
      return;
    case 'name':
      return;
  }
}
