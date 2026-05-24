/**
 * Share Settings — 1:1 port of
 * solidarity/Views/SharingViews/ShareSettingsView.swift.
 *
 * Top-of-screen QR PREVIEW that live-updates as toggles change, followed
 * by a SHARE FIELDS grid (Name locked, Title/Company/Email/Phone/Profile
 * Image/Social Networks/Skills) where every row carries a VC status
 * label when on. Legend below explains the colour code. PROOFS section
 * (Real Human + Age 18+) only renders when the corresponding provable
 * claims exist in the identity store — currently gated TODO because the
 * `provableClaims` / `identityCards` stores haven't landed on Expo yet.
 */
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo } from 'react';
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
import { useMyCard } from '@/cards/cardManager';
import { toVCard } from '@/cards/vCard';
import { haptic } from '@/feedback/haptics';
import { usePreferences } from '@/settings/preferences';
import type { BusinessCardField, BusinessCard } from '@solidarity/shared';

const FIELD_ROWS: readonly FieldDescriptor[] = [
  { key: 'name', icon: 'person.text.rectangle', label: 'Name', locked: true },
  { key: 'title', icon: 'briefcase', label: 'Title' },
  { key: 'company', icon: 'building.2', label: 'Company' },
  { key: 'email', icon: 'envelope', label: 'Email' },
  { key: 'phone', icon: 'phone', label: 'Phone' },
  {
    key: 'profileImage',
    icon: 'person.crop.circle',
    label: 'Profile Image',
    excludedFromVc: true,
  },
  { key: 'socialNetworks', icon: 'link', label: 'Social Networks' },
  { key: 'skills', icon: 'star', label: 'Skills', excludedFromVc: true },
];

export default function ShareSettings(): ReactNode {
  const insets = useSafeAreaInsets();
  const myCard = useMyCard();
  const prefs = usePreferences();
  const enforceMandatory = usePreferences((s) => s.set);

  // Mandatory `shareIsHuman` enforcement: when the holder has the
  // government `is_human` claim the toggle must stay on. The identity
  // store isn't ported yet, so this no-ops today; the hook stays so the
  // wire-up needs no changes once the claims store lands.
  // TODO(identity-store): replace `false` with
  //   useIdentityStore((s) => s.hasHumanClaim).
  const hasHumanClaim = false;
  const hasAgeClaim = false;
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

  const qrPayload = useMemo(() => {
    if (!myCard) return null;
    return toVCard(filterCard(myCard, enabled));
  }, [enabled, myCard]);

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top }}
    >
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Share Settings" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        <QrPreview payload={qrPayload} />
        <FieldToggles prefs={prefs} />
        {hasHumanClaim || hasAgeClaim ? (
          <ProofToggles
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

function QrPreview({ payload }: { readonly payload: string | null }): ReactNode {
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        backgroundColor: Colors.cardBg,
        borderWidth: 1,
        borderColor: Colors.divider,
      }}
    >
      <ThemedText
        variant="caption"
        tone="tertiary"
        style={{ fontFamily: 'Menlo', fontWeight: '700', textAlign: 'center' }}
      >
        QR PREVIEW
      </ThemedText>
      <View
        style={{
          backgroundColor: '#FFFFFF',
          padding: 12,
          aspectRatio: 1,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {payload ? (
          <QRCode value={payload} size={220} backgroundColor="#FFFFFF" />
        ) : (
          <View style={{ alignItems: 'center', gap: 8 }}>
            <SfIcon name="qrcode" size={40} color={Colors.text3} />
            <ThemedText
              variant="caption"
              tone="tertiary"
              style={{ fontFamily: 'Menlo' }}
            >
              Create a card first
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

function FieldToggles({
  prefs,
}: {
  readonly prefs: ReturnType<typeof usePreferences.getState>;
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
          SHARE FIELDS
        </ThemedText>
        <ThemedText
          tone="tertiary"
          style={{ fontFamily: 'Menlo', fontSize: 10 }}
        >
          VC = enters signed credential
        </ThemedText>
      </View>

      <View
        style={{
          gap: 1,
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      >
        {FIELD_ROWS.map((row) => (
          <FieldRow
            key={row.key}
            descriptor={row}
            isOn={isFieldOn(row.key, prefs)}
            onToggle={() => {
              if (row.locked) return;
              haptic('selection');
              toggleField(row.key, prefs);
            }}
          />
        ))}
      </View>

      <View
        className="flex-row items-center"
        style={{ gap: 16, paddingTop: 8 }}
      >
        <LegendItem color={Colors.terminalGreen} label="Verified" />
        <LegendItem color={Colors.warning} label="Self-attested" />
        <LegendItem color={Colors.text3} label="Not in VC" />
      </View>
    </View>
  );
}

function ProofToggles({
  hasHumanClaim,
  hasAgeClaim,
  shareIsHuman,
  shareAgeOver18,
  setShareIsHuman,
  setShareAgeOver18,
}: {
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
        PROOFS
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
            label="Real Human"
            badge="Government"
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
            label="Age 18+"
            badge="Government"
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

/** Strip card fields that aren't in `enabled`. Name always passes through. */
function filterCard(
  card: BusinessCard,
  enabled: readonly BusinessCardField[]
): BusinessCard {
  const set = new Set(enabled);
  return {
    ...card,
    title: set.has('title') ? card.title : undefined,
    company: set.has('company') ? card.company : undefined,
    email: set.has('email') ? card.email : undefined,
    phone: set.has('phone') ? card.phone : undefined,
    profileImage: set.has('profileImage') ? card.profileImage : undefined,
    socialNetworks: set.has('socialNetworks') ? card.socialNetworks : [],
    skills: set.has('skills') ? card.skills : [],
  };
}
