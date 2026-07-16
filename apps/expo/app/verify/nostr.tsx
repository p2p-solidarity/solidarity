/**
 * Connect Nostr — the S-tier badge binding wizard (04-plan Phase A4 task
 * A4.4; docs/ref/03-app-web-mechanisms.md §5's "我的徽章綁定管理(S/A/B/C
 * 各平台精靈)"; reached from the Verify tab's "Badge Bindings" section).
 *
 * Flow: choose method (derive from the recovery phrase via
 * `provisionFromRootMnemonic` — Face ID — or paste an existing `nsec1…`
 * via `importNsec`) -> show `DEFAULT_RELAYS` for the pre-first-publish
 * confirmation A4.2 requires -> `useProfileStore().publishToNostr` -> show
 * the per-relay `PublishReport` honestly (e.g. "2 of 3 accepted"), never
 * collapsed to a bare "done". All transition logic lives in the pure
 * `@/nostr/connectWizard` reducer (unit-tested there); this screen only
 * dispatches actions in response to real async calls.
 *
 * Two gates before the wizard itself, matching `ProfileSummaryCard`'s /
 * `app/me/edit.tsx`'s existing patterns (never fabricate — root CLAUDE.md
 * rule 8):
 *   1. No root identity provisioned yet -> honest CTA into onboarding
 *      replay (Nostr binds `profile.did`, which needs a root key first).
 *   2. Root key exists but no Profile Record has been saved yet -> honest
 *      CTA into `/me/edit` (`publishToNostr` requires a saved profile).
 *
 * A Face-ID cancel (`biometricDenied`) is treated as a silent return to
 * `chooseMethod`, not an alarming error — see `connectWizard.ts`'s
 * `provisioningCancelled` doc and `identity-export.tsx`'s existing
 * precedent for the same outcome.
 */
import { router } from 'expo-router';
import { useEffect, useReducer, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { truncateNpub } from '@/badges/nostrBadgeDisplay';
import { SfIcon } from '@/components/icons/SfIcon';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import {
  initialNostrConnectWizardState,
  nostrConnectWizardReducer,
} from '@/nostr/connectWizard';
import { DEFAULT_RELAYS, type PublishReport } from '@/nostr/publish';
import { decodeNsec, getNostrPubkey, hasNostrKey, importNsec, npubEncode, provisionFromRootMnemonic } from '@/nostr/userKey';
import { useProfileStore } from '@/profile/store';

type TFn = ReturnType<typeof useTranslation>['t'];

export default function ConnectNostrScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const profileStatus = useProfileStore((s) => s.status);
  const publishToNostr = useProfileStore((s) => s.publishToNostr);

  // Optimistic default — see `ProfileSummaryCard`'s doc for why (the common
  // case already has a provisioned root key).
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

  const [state, dispatch] = useReducer(nostrConnectWizardReducer, DEFAULT_RELAYS, initialNostrConnectWizardState);

  // Already-provisioned fast path: skip straight to confirmRelays so
  // re-opening this screen after a successful connect shows "publish
  // again" instead of forcing Face ID / nsec re-entry.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const has = await hasNostrKey();
      if (!has || cancelled) return;
      const pubkey = await getNostrPubkey();
      if (!pubkey.ok || cancelled) return;
      const npub = npubEncode(pubkey.value);
      if (!npub.ok || cancelled) return;
      dispatch({ type: 'provisioningSucceeded', npub: npub.value });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onChooseMnemonic = async () => {
    dispatch({ type: 'chooseMnemonic' });
    const r = await provisionFromRootMnemonic();
    if (!r.ok) {
      if (r.error === 'biometricDenied') dispatch({ type: 'provisioningCancelled' });
      else dispatch({ type: 'provisioningFailed', message: r.error });
      return;
    }
    const npub = npubEncode(r.value);
    if (!npub.ok) {
      dispatch({ type: 'provisioningFailed', message: npub.error });
      return;
    }
    dispatch({ type: 'provisioningSucceeded', npub: npub.value });
  };

  const onSubmitNsec = async () => {
    const nsec = state.nsecInput.trim();
    dispatch({ type: 'submitNsec' });
    const imported = await importNsec(nsec);
    if (!imported.ok) {
      dispatch({ type: 'provisioningFailed', message: imported.error });
      return;
    }
    const npub = npubEncode(imported.value);
    if (!npub.ok) {
      dispatch({ type: 'provisioningFailed', message: npub.error });
      return;
    }
    dispatch({ type: 'provisioningSucceeded', npub: npub.value });
  };

  const onConfirmPublish = async () => {
    dispatch({ type: 'confirmPublish' });
    const r = await publishToNostr(state.relays);
    if (!r.ok) {
      dispatch({ type: 'publishingFailed', message: r.error });
      return;
    }
    dispatch({ type: 'publishingSucceeded', outcome: r.value });
  };

  if (!rootKeyPresent) {
    return (
      <GateScreen
        title={t('nostrConnect.title')}
        message={t('profileCard.needsIdentitySetup')}
        ctaLabel={t('profileCard.setUpIdentity')}
        onCta={() => {
          router.push('/onboarding?replay=1');
        }}
      />
    );
  }

  if (profileStatus !== 'ready' || !record) {
    return (
      <GateScreen
        title={t('nostrConnect.title')}
        message={t('profileCard.emptyHint')}
        ctaLabel={t('profileCard.createPage')}
        onCta={() => {
          router.push('/me/edit');
        }}
      />
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('nostrConnect.cancel')} onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('nostrConnect.title')} />

      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 48, gap: 24 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        {state.status === 'idle' && state.step === 'chooseMethod' ? (
          <ChooseMethodStep onChooseMnemonic={() => { void onChooseMnemonic(); }} onChooseNsec={() => { dispatch({ type: 'chooseNsec' }); }} />
        ) : null}

        {state.status === 'idle' && state.step === 'pasteNsec' ? (
          <PasteNsecStep
            value={state.nsecInput}
            onChange={(value) => { dispatch({ type: 'setNsecInput', value }); }}
            onBack={() => { dispatch({ type: 'backToChooseMethod' }); }}
            onSubmit={() => { void onSubmitNsec(); }}
          />
        ) : null}

        {state.status === 'provisioning' ? <BusyStep label={t('nostrConnect.provisioning')} /> : null}

        {state.status === 'idle' && state.step === 'confirmRelays' ? (
          <ConfirmRelaysStep npub={state.npub} relays={state.relays} onPublish={() => { void onConfirmPublish(); }} />
        ) : null}

        {state.status === 'publishing' ? <BusyStep label={t('nostrConnect.publishing')} /> : null}

        {state.status === 'published' && state.outcome ? (
          <PublishedStep
            profileReport={state.outcome.profile}
            kind0Report={state.outcome.kind0}
            onDone={() => { router.back(); }}
          />
        ) : null}

        {state.status === 'error' ? (
          <ErrorStep
            message={state.errorMessage ?? ''}
            onRetry={() => { dispatch({ type: 'retry' }); }}
            onCancel={() => { router.back(); }}
          />
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function GateScreen({
  title,
  message,
  ctaLabel,
  onCta,
}: {
  readonly title: string;
  readonly message: string;
  readonly ctaLabel: string;
  readonly onCta: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('nostrConnect.cancel')} onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={title} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
        <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
          {message}
        </ThemedText>
        <ThemedButton label={ctaLabel} variant="primary" onPress={onCta} />
      </View>
    </View>
  );
}

function ChooseMethodStep({
  onChooseMnemonic,
  onChooseNsec,
}: {
  readonly onChooseMnemonic: () => void;
  readonly onChooseNsec: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 16 }}>
      <ThemedText variant="bodyMedium" tone="secondary">
        {t('nostrConnect.intro')}
      </ThemedText>
      <ThemedButton
        label={t('nostrConnect.chooseMnemonic')}
        variant="primary"
        fullWidth
        leadingIcon={<SfIcon name="faceid" size={16} color={Colors.pageBg} />}
        onPress={onChooseMnemonic}
      />
      <ThemedButton
        label={t('nostrConnect.chooseNsec')}
        variant="secondary"
        fullWidth
        onPress={onChooseNsec}
      />
    </View>
  );
}

function PasteNsecStep({
  value,
  onChange,
  onBack,
  onSubmit,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
}) {
  const { t } = useTranslation();
  // Live validation as the user pastes/types — decode WITHOUT persisting
  // (`decodeNsec`, not `importNsec`), so the field shows the resolved npub
  // the instant the string is a real key and gates "Connect" on it, instead
  // of committing first and only then surfacing "invalid" in an error step.
  // reveal/paste/secure-entry all come from ThemedTextInput kind="secret".
  const trimmed = value.trim();
  const decoded = trimmed.length > 0 ? decodeNsec(trimmed) : null;
  const npub = decoded?.ok === true ? npubEncode(decoded.value) : null;
  const validNpub = npub?.ok === true ? npub.value : null;

  return (
    <View style={{ gap: 12 }}>
      <ThemedTextInput
        kind="secret"
        label={t('nostrConnect.nsecLabel')}
        value={value}
        onChangeText={onChange}
        placeholder={t('nostrConnect.nsecPlaceholder')}
        showPaste
        error={trimmed.length > 0 && validNpub === null ? t('nostrConnect.nsecInvalid') : null}
        hint={validNpub ? t('nostrConnect.nsecValid', { npub: truncateNpub(validNpub) }) : null}
        hintTone="success"
      />
      <ThemedButton
        label={t('nostrConnect.connect')}
        variant="primary"
        fullWidth
        disabled={validNpub === null}
        onPress={onSubmit}
      />
      <ThemedButton label={t('nostrConnect.back')} variant="secondary" fullWidth onPress={onBack} />
    </View>
  );
}

function BusyStep({ label }: { readonly label: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 32 }}>
      <ActivityIndicator size="small" color={Colors.text2} />
      <ThemedText variant="bodyMedium" tone="secondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ConfirmRelaysStep({
  npub,
  relays,
  onPublish,
}: {
  readonly npub: string | null;
  readonly relays: readonly string[];
  readonly onPublish: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 16 }}>
      {npub ? (
        <View style={{ gap: 4 }}>
          <ThemedText variant="label">{t('nostrConnect.npubLabel')}</ThemedText>
          <Text className="text-text1 text-[13px]" style={{ fontFamily: 'Menlo' }}>
            {truncateNpub(npub)}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <ThemedText variant="label">{t('nostrConnect.relaysLabel')}</ThemedText>
        <ThemedText variant="caption" tone="secondary">
          {t('nostrConnect.relayExplain')}
        </ThemedText>
        <View style={{ gap: 6, marginTop: 4 }}>
          {relays.map((relay) => (
            <View key={relay} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: Colors.divider, padding: 10 }}>
              <SfIcon name="dot.radiowaves.left.and.right" size={13} color={Colors.text3} />
              <Text className="text-text2 text-[13px]" numberOfLines={1} style={{ flex: 1 }}>
                {relay}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <ThemedButton label={t('nostrConnect.publish')} variant="primary" fullWidth onPress={onPublish} />
    </View>
  );
}

function PublishedStep({
  profileReport,
  kind0Report,
  onDone,
}: {
  readonly profileReport: PublishReport;
  readonly kind0Report: PublishReport;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 20 }}>
      <ThemedText variant="titleMedium">{t('nostrConnect.publishedTitle')}</ThemedText>
      <RelayReportSection title={t('nostrConnect.profilePointerReport')} report={profileReport} t={t} />
      <RelayReportSection title={t('nostrConnect.kind0Report')} report={kind0Report} t={t} />
      <ThemedButton label={t('nostrConnect.done')} variant="primary" fullWidth onPress={onDone} />
    </View>
  );
}

function RelayReportSection({ title, report, t }: { readonly title: string; readonly report: PublishReport; readonly t: TFn }) {
  return (
    <View style={{ gap: 8 }}>
      <ThemedText variant="label">{title}</ThemedText>
      <ThemedText variant="caption" tone={report.success ? 'secondary' : 'error'}>
        {t('nostrConnect.acceptedSummary', { accepted: report.acceptedCount, total: report.results.length })}
      </ThemedText>
      <View style={{ gap: 6 }}>
        {report.results.map((r) => (
          <View key={r.relay} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SfIcon
              name={r.accepted ? 'checkmark.circle.fill' : 'xmark.circle'}
              size={14}
              color={r.accepted ? Colors.terminalGreen : Colors.destructive}
            />
            <Text className="text-text2 text-[12px]" numberOfLines={1} style={{ flex: 1 }}>
              {r.relay}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ErrorStep({
  message,
  onRetry,
  onCancel,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          borderWidth: 1,
          borderColor: `${Colors.destructive}66`,
          backgroundColor: `${Colors.destructive}14`,
          padding: 12,
          gap: 4,
        }}
      >
        <ThemedText variant="bodyMedium" tone="error">
          {t('nostrConnect.errorTitle')}
        </ThemedText>
        <Text className="text-text3 text-[12px]" style={{ fontFamily: 'Menlo' }}>
          {message}
        </Text>
      </View>
      <ThemedButton label={t('nostrConnect.tryAgain')} variant="primary" fullWidth onPress={onRetry} />
      <ThemedButton label={t('nostrConnect.cancel')} variant="secondary" fullWidth onPress={onCancel} />
    </View>
  );
}
