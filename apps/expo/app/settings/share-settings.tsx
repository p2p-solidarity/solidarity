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
import { safeBack } from '@/navigation/safeBack';
import { Image } from 'expo-image';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
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
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import { generateQrPng } from '@/cards/qrCodeManager';
import { shareFieldPreferencesFromFields } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
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
  // NOTE: `profileImage` has no row here. The legacy QR wire drops it
  // unconditionally (src/cards/solidarityQrTypes.ts `resolveSelectedFields`),
  // so a toggle would change nothing — G2 removed the dead control. The
  // `shareProfileImage` pref + FIELD_PREF_KEY entry stay for type/wire
  // compatibility; they are simply no longer reachable from this UI.
  { key: 'socialNetworks', icon: 'link', labelKey: 'shareSettings.field.socialNetworks' },
  { key: 'skills', icon: 'star', labelKey: 'shareSettings.field.skills', excludedFromVc: true },
];

/**
 * Single source of truth: each toggleable share field maps 1:1 to its boolean
 * preference key. `name` is always shared and has no toggle, so it's excluded.
 * Everything else (`enabled`, `isFieldOn`, `toggleField`) derives from here
 * instead of repeating the same field→pref switch three times.
 */
type ShareFieldKey = Exclude<BusinessCardField, 'name'>;
type ShareFieldPrefKey =
  | 'shareTitle'
  | 'shareCompany'
  | 'shareEmail'
  | 'sharePhone'
  | 'shareProfileImage'
  | 'shareSocialNetworks'
  | 'shareSkills';

const FIELD_PREF_KEY: Readonly<Record<ShareFieldKey, ShareFieldPrefKey>> = {
  title: 'shareTitle',
  company: 'shareCompany',
  email: 'shareEmail',
  phone: 'sharePhone',
  profileImage: 'shareProfileImage',
  socialNetworks: 'shareSocialNetworks',
  skills: 'shareSkills',
};

/**
 * Canonical legacy business-card QR preview state. The old QR is retained
 * while a new one signs (`loading` carries `lastUri`), and a failed build
 * resolves to `error` with a retry — never an eternal spinner. This screen
 * is the single source of truth for the legacy wire; `solidarity-qr`
 * redirects here (G2 dedupe).
 */
type QrPreviewState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading'; readonly lastUri: string | null }
  | { readonly kind: 'ready'; readonly uri: string }
  | { readonly kind: 'error' };

export default function ShareSettings(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const myCard = useMyCardDetail();
  const hydrateCards = useCardStore((s) => s.hydrate);
  useEffect(() => { void hydrateCards(); }, [hydrateCards]);
  const prefs = usePreferences();
  const enforceMandatory = usePreferences((s) => s.set);
  const [qr, setQr] = useState<QrPreviewState>({ kind: 'empty' });
  const [retryNonce, setRetryNonce] = useState(0);

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

  const enabled = useMemo<readonly BusinessCardField[]>(
    () => FIELD_ROWS.filter((r) => isFieldOn(r.key, prefs)).map((r) => r.key),
    [prefs]
  );

  useEffect(() => {
    if (!myCard) {
      setQr({ kind: 'empty' });
      return;
    }

    let cancelled = false;
    // Keep the last good QR on screen while the next one signs (no spinner
    // flash per tap); only fall back to a spinner on the very first build.
    setQr((prev) => ({
      kind: 'loading',
      lastUri:
        prev.kind === 'ready'
          ? prev.uri
          : prev.kind === 'loading'
            ? prev.lastUri
            : null,
    }));
    // Debounce: toggling several fields in a row coalesces into one signed
    // rebuild instead of one Face ID sign per toggle.
    const handle = setTimeout(() => {
      void buildRuntimeSolidarityQrWire(
        myCard,
        shareFieldPreferencesFromFields(enabled),
        { proofClaims: selectedProofClaims }
      )
        .then((next) =>
          generateQrPng(next.wire, { size: 220, startingLevel: next.startingLevel })
        )
        .then((uri) => {
          if (!cancelled) setQr({ kind: 'ready', uri });
        })
        .catch(() => {
          // Fail-visible, not fail-silent: surface an error+retry so a failed
          // sign never leaves the preview stuck spinning forever.
          if (!cancelled) setQr({ kind: 'error' });
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [enabled, myCard, selectedProofClaims, retryNonce]);

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top }}
    >
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('legacyCard.title')} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        <QrPreview
          state={qr}
          onRetry={() => { setRetryNonce((value) => value + 1); }}
          t={t}
        />
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
  state,
  onRetry,
  t,
}: {
  readonly state: QrPreviewState;
  readonly onRetry: () => void;
  readonly t: (key: string) => string;
}): ReactNode {
  // Figma 726:23661 — the QR sits directly inside a searchBg-grey rounded
  // card (no white inner box, no border, no "QR PREVIEW" caption). The QR's
  // own white module background supplies the scannable quiet-zone.
  //
  // Three explicit states (Rule 8): a `ready`/`loading` QR renders the image,
  // a first build shows a spinner, a failed build shows error + retry, and
  // no-card shows the create-a-card hint. Never an eternal spinner.
  const visibleUri =
    state.kind === 'ready'
      ? state.uri
      : state.kind === 'loading'
        ? state.lastUri
        : null;

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
      {visibleUri ? (
        <Image
          source={{ uri: visibleUri }}
          contentFit="contain"
          style={{
            width: 220,
            height: 220,
          }}
        />
      ) : state.kind === 'loading' ? (
        <ActivityIndicator color={Colors.accentRose} />
      ) : state.kind === 'error' ? (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <SfIcon name="exclamationmark.triangle" size={32} color={Colors.destructive} />
          <ThemedText
            variant="caption"
            tone="error"
            style={{ textAlign: 'center' }}
          >
            {t('legacyCard.qrError')}
          </ThemedText>
          <ThemedButton
            label={t('legacyCard.retry')}
            variant="secondary"
            onPress={onRetry}
          />
        </View>
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
  if (field === 'name') return true;
  return prefs[FIELD_PREF_KEY[field]];
}

function toggleField(
  field: BusinessCardField,
  prefs: ReturnType<typeof usePreferences.getState>
): void {
  if (field === 'name') return;
  const key = FIELD_PREF_KEY[field];
  prefs.set(key, !prefs[key]);
}
