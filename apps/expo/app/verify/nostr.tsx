/**
 * Advanced publish route. The default surface has one action and provisions
 * only after that tap. Existing-key import remains behind “Advanced options”.
 */
import { router } from 'expo-router';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { truncateNpub } from '@/badges/nostrBadgeDisplay';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { HttpsOwnershipCard } from '@/components/publish/HttpsOwnershipCard';
import {
  PublishingConstellation,
  type PublishAnimationPhase,
} from '@/components/publish/PublishingConstellation';
import {
  PublishOutcomeStep,
  relayNodeStatuses,
} from '@/components/publish/PublishOutcomeStep';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import {
  initialNostrConnectWizardState,
  isBiometricCancellation,
  isNostrPublishOutcomePartiallyAccepted,
  nostrConnectWizardReducer,
  relayRejectionLines,
} from '@/nostr/connectWizard';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import {
  decodeNsec,
  hasNostrKey,
  importNsec,
  npubEncode,
  provisionFromRootMnemonic,
} from '@/nostr/userKey';
import { useProfileStore, type NostrPublishOutcome } from '@/profile/store';
import { verifyHttpsOwnership, type HttpsOwnershipEvidence } from '@/profile/httpsOwnership';
import { buildProfileShareModel } from '@/components/me/meProfileModel';

type TFn = ReturnType<typeof useTranslation>['t'];

export default function PublishPageScreen(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const record = useProfileStore((state) => state.record);
  const jws = useProfileStore((state) => state.jws);
  const profileStatus = useProfileStore((state) => state.status);
  const publishToNostr = useProfileStore((state) => state.publishToNostr);
  const [rootKeyPresent, setRootKeyPresent] = useState(true);
  const [state, dispatch] = useReducer(
    nostrConnectWizardReducer,
    undefined,
    initialNostrConnectWizardState
  );
  const actionInFlight = useRef(false);
  const [websiteEvidence, setWebsiteEvidence] = useState<readonly HttpsOwnershipEvidence[] | null>(null);

  // Root identity is the only async gate. First paint stays optimistic, as
  // on the existing Me editor, then resolves to the honest setup state.
  useEffect(() => {
    let active = true;
    void hasRootKey().then((has) => {
      if (active) setRootKeyPresent(has);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!record || !jws || record.links.length === 0) {
      setWebsiteEvidence([]);
      return () => {
        active = false;
      };
    }
    const controller = new AbortController();
    setWebsiteEvidence(null);
    const shareModel = buildProfileShareModel(record, jws);
    const profileUrls = [shareModel.offlineUrl, shareModel.shortUrl].filter(
      (url): url is string => url !== null,
    );
    void verifyHttpsOwnership({
      did: record.did,
      links: record.links.map((link) => link.url),
      profileUrls,
      signal: controller.signal,
    }).then((evidence) => {
      if (active) setWebsiteEvidence(evidence);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [jws, record]);

  const reportFailure = (error: string, outcome: NostrPublishOutcome | null = null) => {
    showError({
      context: 'Publish page',
      summary: t('nostrConnect.publishFailedSummary'),
      error: new Error(outcome ? publishFailureDetail(outcome, t) : error),
    });
  };

  const finishPublish = async () => {
    const result = await publishToNostr(DEFAULT_RELAYS);
    if (!result.ok) {
      dispatch({ type: 'publishingFailed', message: result.error });
      reportFailure(result.error);
      return;
    }
    dispatch({ type: 'publishingSucceeded', outcome: result.value });
    // Partial acceptance (≥1 relay holding each copy) is an accepted outcome
    // (04-plan S8f) — the outcome step renders the honest per-relay panel.
    // Only zero acceptance of either copy raises the error sheet.
    if (!isNostrPublishOutcomePartiallyAccepted(result.value)) {
      reportFailure('publish quorum was not met', result.value);
    }
  };

  const publishDefault = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    try {
      if (await hasNostrKey()) {
        dispatch({ type: 'startPublishing' });
        await finishPublish();
        return;
      }

      dispatch({ type: 'startProvisioning' });
      const provisioned = await provisionFromRootMnemonic();
      if (!provisioned.ok) {
        if (isBiometricCancellation(provisioned.error)) {
          dispatch({ type: 'provisioningCancelled' });
          return;
        }
        dispatch({ type: 'provisioningFailed', message: provisioned.error });
        showError({
          context: 'Publish page › Confirm',
          summary: t('nostrConnect.provisionFailedSummary'),
          error: new Error(provisioned.error),
        });
        return;
      }
      dispatch({ type: 'provisioningSucceeded' });
      await finishPublish();
    } finally {
      actionInFlight.current = false;
    }
  };

  const importAndPublish = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    try {
      const nsec = state.nsecInput.trim();
      dispatch({ type: 'submitNsec' });
      const imported = await importNsec(nsec);
      if (!imported.ok) {
        dispatch({ type: 'provisioningFailed', message: imported.error });
        showError({
          context: 'Publish page › Advanced import',
          summary: t('nostrConnect.importFailedSummary'),
          error: new Error(imported.error),
        });
        return;
      }
      dispatch({ type: 'provisioningSucceeded' });
      await finishPublish();
    } finally {
      actionInFlight.current = false;
    }
  };

  if (!rootKeyPresent) {
    return (
      <GateScreen
        message={t('profileCard.needsIdentitySetup')}
        ctaLabel={t('profileCard.setUpIdentity')}
        onCta={() => {
          router.push('/onboarding?replay=1');
        }}
      />
    );
  }

  if (profileStatus !== 'ready' || record === null) {
    return (
      <GateScreen
        message={t('profileCard.emptyHint')}
        ctaLabel={t('profileCard.createPage')}
        onCta={() => {
          router.push('/me/edit');
        }}
      />
    );
  }

  const alreadyPublished = record.alsoKnownAs.some((alias) => alias.startsWith('nostr:npub'));

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar
        title={t('nostrConnect.cancel')}
        onPress={() => {
          router.back();
        }}
      />
      <SettingsScreenTitle title={t('nostrConnect.title')} />

      <KeyboardAwareScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 48,
        }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}>
        {state.status === 'idle' && state.step === 'ready' ? (
          <ReadyStep
            alreadyPublished={alreadyPublished}
            websiteEvidence={websiteEvidence}
            onPublish={() => {
              void publishDefault();
            }}
            onShowAdvanced={() => {
              dispatch({ type: 'showNsecImport' });
            }}
          />
        ) : null}

        {state.status === 'idle' && state.step === 'pasteNsec' ? (
          <PasteNsecStep
            value={state.nsecInput}
            onChange={(value) => {
              dispatch({ type: 'setNsecInput', value });
            }}
            onBack={() => {
              dispatch({ type: 'hideNsecImport' });
            }}
            onSubmit={() => {
              void importAndPublish();
            }}
          />
        ) : null}

        {state.status === 'provisioning' ? (
          <BusyStep phase="provisioning" label={t('nostrConnect.provisioning')} />
        ) : null}
        {state.status === 'publishing' ? (
          <BusyStep phase="publishing" label={t('nostrConnect.publishing')} />
        ) : null}
        {state.status === 'published' && state.outcome ? (
          <PublishOutcomeStep
            outcome={state.outcome}
            onDone={() => {
              router.back();
            }}
          />
        ) : null}
        {state.status === 'error' ? (
          <ErrorStep
            stage={state.errorStage}
            outcome={state.outcome}
            onRetry={() => {
              dispatch({ type: 'retry' });
            }}
            onCancel={() => {
              router.back();
            }}
          />
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function ReadyStep({
  alreadyPublished,
  websiteEvidence,
  onPublish,
  onShowAdvanced,
}: {
  readonly alreadyPublished: boolean;
  readonly websiteEvidence: readonly HttpsOwnershipEvidence[] | null;
  readonly onPublish: () => void;
  readonly onShowAdvanced: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
      <PublishingConstellation phase="ready" />
      <ThemedSurface variant="inset" className="rounded-none p-4">
        <View style={{ gap: 10 }}>
          <SfIcon name="checkmark.seal" size={24} color={Colors.primaryBlue} />
          <ThemedText variant="titleMedium">{t('nostrConnect.promiseTitle')}</ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {t('nostrConnect.intro')}
          </ThemedText>
        </View>
      </ThemedSurface>
      <HttpsOwnershipCard evidence={websiteEvidence} />
      <ThemedButton
        label={t(alreadyPublished ? 'nostrConnect.publishAgain' : 'nostrConnect.publish')}
        variant="primary"
        fullWidth
        onPress={onPublish}
      />
      <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        {t('nostrConnect.publishHint')}
      </ThemedText>
      <PressableScale
        haptic="tap"
        onPress={onShowAdvanced}
        accessibilityRole="button"
        accessibilityLabel={t('nostrConnect.advancedOptions')}
        style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText variant="caption" tone="tertiary">
          {t('nostrConnect.advancedOptions')}
        </ThemedText>
      </PressableScale>
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
  readonly onChange: (value: string) => void;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const trimmed = value.trim();
  const decoded = trimmed.length > 0 ? decodeNsec(trimmed) : null;
  const encoded = decoded?.ok === true ? npubEncode(decoded.value) : null;
  const validNpub = encoded?.ok === true ? encoded.value : null;

  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
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
        label={t('nostrConnect.importAndPublish')}
        variant="primary"
        fullWidth
        disabled={validNpub === null}
        onPress={onSubmit}
      />
      <ThemedButton
        label={t('nostrConnect.back')}
        variant="secondary"
        fullWidth
        onPress={onBack}
      />
    </View>
  );
}

function BusyStep({
  phase,
  label,
}: {
  readonly phase: Extract<PublishAnimationPhase, 'provisioning' | 'publishing'>;
  readonly label: string;
}): ReactNode {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <PublishingConstellation phase={phase} />
      <ThemedText variant="bodyMedium" tone="secondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ErrorStep({
  stage,
  outcome,
  onRetry,
  onCancel,
}: {
  readonly stage: 'provisioning' | 'publishing' | null;
  readonly outcome: NostrPublishOutcome | null;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
      <PublishingConstellation
        phase={outcome ? 'partial' : 'error'}
        relayStatuses={outcome ? relayNodeStatuses(outcome) : undefined}
      />
      <ThemedSurface variant="outlined" className="rounded-none p-4">
        <View style={{ gap: 8 }}>
          <ThemedText variant="titleMedium" tone="error">
            {t('nostrConnect.errorTitle')}
          </ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {t(
              stage === 'provisioning'
                ? 'nostrConnect.provisionFailedSummary'
                : 'nostrConnect.publishFailedSummary'
            )}
          </ThemedText>
        </View>
      </ThemedSurface>
      <ThemedButton
        label={t('nostrConnect.tryAgain')}
        variant="primary"
        fullWidth
        onPress={onRetry}
      />
      <ThemedButton
        label={t('nostrConnect.cancel')}
        variant="secondary"
        fullWidth
        onPress={onCancel}
      />
    </View>
  );
}

function GateScreen({
  message,
  ctaLabel,
  onCta,
}: {
  readonly message: string;
  readonly ctaLabel: string;
  readonly onCta: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar
        title={t('nostrConnect.cancel')}
        onPress={() => {
          router.back();
        }}
      />
      <SettingsScreenTitle title={t('nostrConnect.title')} />
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
          {message}
        </ThemedText>
        <ThemedButton label={ctaLabel} variant="primary" onPress={onCta} />
      </View>
    </View>
  );
}

function publishFailureDetail(outcome: NostrPublishOutcome, t: TFn): string {
  return [
    t('nostrConnect.publishReportDetail', {
      profileAccepted: outcome.profile.acceptedCount,
      profileTotal: outcome.profile.results.length,
      bindingAccepted: outcome.kind0.acceptedCount,
      bindingTotal: outcome.kind0.results.length,
    }),
    ...relayRejectionLines(outcome),
  ].join('\n');
}
