import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  beginBlueskyConnect,
  confirmBlueskyReplacement,
  type BlueskyConnectedOutcome,
  type BlueskyWizardError,
  type BlueskyWizardErrorKind,
} from '@/atproto/blueskyWizard';
import { BindingBadgeChip } from '@/components/badges/BindingBadgeChip';
import { SfIcon } from '@/components/icons/SfIcon';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { confirmDialog } from '@/feedback/confirmDialog';
import { useTranslation } from '@/i18n';
import {
  isNostrPublishOutcomeSuccessful,
  publishWithNostrAutoSetup,
} from '@/nostr/connectWizard';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { hasNostrKey, provisionFromRootMnemonic } from '@/nostr/userKey';
import { shouldAutoRepublish } from '@/profile/publishingPolicy';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';

type AutoRepublishStatus = 'notRequested' | 'published' | 'failed';

type ScreenState =
  | { readonly kind: 'input' }
  | { readonly kind: 'working' }
  | {
      readonly kind: 'success';
      readonly outcome: BlueskyConnectedOutcome;
      readonly autoRepublish: AutoRepublishStatus;
    }
  | { readonly kind: 'error'; readonly error: BlueskyWizardError };

export default function BlueskyConnectScreen(): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const record = useProfileStore((state) => state.record);
  const profileStatus = useProfileStore((state) => state.status);
  const publishToNostr = useProfileStore((state) => state.publishToNostr);
  const autoRepublishEnabled = usePreferences((state) => state.nostrAutoRepublish);
  const isAlreadyPublished =
    record?.alsoKnownAs.some((alias) => alias.startsWith('nostr:npub')) === true;
  const existingHandle =
    record?.alsoKnownAs.find((alias) => alias.startsWith('at://'))?.slice('at://'.length) ?? '';
  const [handle, setHandle] = useState(existingHandle);
  const [screen, setScreen] = useState<ScreenState>({ kind: 'input' });
  const handleWithoutAt = handle.trim().replace(/^@/u, '');
  const showStandardSuffix = !handleWithoutAt.includes('.');

  const finishConnected = async (outcome: BlueskyConnectedOutcome) => {
    if (!shouldAutoRepublish(isAlreadyPublished, autoRepublishEnabled)) {
      setScreen({ kind: 'success', outcome, autoRepublish: 'notRequested' });
      return;
    }
    const published = await publishWithNostrAutoSetup({
      hasKey: hasNostrKey,
      provision: provisionFromRootMnemonic,
      publish: async () => await publishToNostr(DEFAULT_RELAYS),
    });
    setScreen({
      kind: 'success',
      outcome,
      autoRepublish:
        published.ok && isNostrPublishOutcomeSuccessful(published.value) ? 'published' : 'failed',
    });
  };

  const connect = async () => {
    setScreen({ kind: 'working' });
    const initial = await beginBlueskyConnect(handle);
    if (!initial.ok) {
      setScreen({ kind: 'error', error: initial.error });
      return;
    }
    if (initial.value.kind === 'connected') {
      await finishConnected(initial.value);
      return;
    }

    const replacement = initial.value;
    const confirmed = await confirmDialog({
      title: t('blueskyConnect.replaceTitle'),
      message: t('blueskyConnect.replaceMessage', {
        existing: replacement.existingHandle,
        replacement: replacement.replacementHandle,
      }),
      confirmLabel: t('blueskyConnect.replaceConfirm'),
      cancelLabel: t('alert.cancel'),
    });
    if (!confirmed) {
      setScreen({ kind: 'input' });
      return;
    }

    setScreen({ kind: 'working' });
    const next = await confirmBlueskyReplacement(replacement);
    if (!next.ok) {
      setScreen({ kind: 'error', error: next.error });
    } else if (next.value.kind === 'connected') {
      await finishConnected(next.value);
    } else {
      setScreen({ kind: 'error', error: { kind: 'profileSaveFailed' } });
    }
  };

  if (profileStatus !== 'ready' || record === null) {
    return (
      <GateScreen
        message={t('blueskyConnect.needsPage')}
        onCreatePage={() => {
          router.push('/me/edit');
        }}
      />
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar
        title={t('blueskyConnect.cancel')}
        onPress={() => {
          router.back();
        }}
      />
      <SettingsScreenTitle title={t('blueskyConnect.title')} />

      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 48,
        }}>
        {screen.kind === 'input' ? (
          <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
            <ThemedSurface variant="inset" className="rounded-none p-4">
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <SfIcon name="checkmark.seal.fill" size={17} color={Colors.primaryBlue} />
                  <ThemedText variant="titleMedium">{t('blueskyConnect.promiseTitle')}</ThemedText>
                </View>
                <ThemedText variant="bodySmall" tone="secondary">
                  {t('blueskyConnect.promise')}
                </ThemedText>
              </View>
            </ThemedSurface>

            <ThemedTextInput
              kind="handle"
              value={handle}
              onChangeText={setHandle}
              label={t('blueskyConnect.handleLabel')}
              placeholder={t('blueskyConnect.handlePlaceholder')}
              inlineSuffix={showStandardSuffix ? '.bsky.social' : null}
              autoCapitalize="none"
              autoCorrect={false}
              showClear
              returnKeyType="go"
              onSubmitEditing={() => {
                void connect();
              }}
            />
            <ThemedButton
              label={t('blueskyConnect.connect')}
              variant="primary"
              fullWidth
              disabled={handle.trim().length === 0}
              onPress={() => {
                void connect();
              }}
            />
          </View>
        ) : null}

        {screen.kind === 'working' ? <WorkingState /> : null}
        {screen.kind === 'success' ? (
          <SuccessState outcome={screen.outcome} autoRepublish={screen.autoRepublish} />
        ) : null}
        {screen.kind === 'error' ? (
          <ErrorState
            errorKind={screen.error.kind}
            onRetry={() => {
              setScreen({ kind: 'input' });
            }}
          />
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function WorkingState(): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator size="small" color={Colors.text2} />
      <ThemedText variant="bodyMedium" tone="secondary">
        {t('blueskyConnect.working')}
      </ThemedText>
    </View>
  );
}

function SuccessState({
  outcome,
  autoRepublish,
}: {
  readonly outcome: BlueskyConnectedOutcome;
  readonly autoRepublish: AutoRepublishStatus;
}): ReactNode {
  const { t } = useTranslation();
  const state = outcome.verification.state;
  const copyKey =
    state === 'verified'
      ? 'blueskyConnect.successVerified'
      : state === 'stale'
        ? 'blueskyConnect.successStale'
        : 'blueskyConnect.successDeclared';

  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
      <ThemedSurface variant="inset" className="rounded-none p-4">
        <View style={{ gap: 12 }}>
          <BindingBadgeChip
            result={{ provider: 'bluesky', result: outcome.verification }}
            animateStateChange={false}
          />
          <ThemedText variant="bodySmall" tone="secondary">
            {t(copyKey)}
          </ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            @{outcome.handle}
          </ThemedText>
          {autoRepublish === 'failed' ? (
            <ThemedText variant="caption" tone="error">
              {t('blueskyConnect.autoRepublishFailed')}
            </ThemedText>
          ) : null}
        </View>
      </ThemedSurface>
      <ThemedButton
        label={t('blueskyConnect.done')}
        variant="inverted"
        fullWidth
        onPress={() => {
          router.back();
        }}
      />
    </View>
  );
}

function ErrorState({
  errorKind,
  onRetry,
}: {
  readonly errorKind: BlueskyWizardErrorKind;
  readonly onRetry: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
      <ThemedSurface variant="outlined" className="rounded-none p-4">
        <View style={{ gap: 8 }}>
          <ThemedText variant="titleMedium" tone="error">
            {t('blueskyConnect.errorTitle')}
          </ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {t(errorCopyKey(errorKind))}
          </ThemedText>
        </View>
      </ThemedSurface>
      <ThemedButton
        label={t('blueskyConnect.retry')}
        variant="primary"
        fullWidth
        onPress={onRetry}
      />
      <ThemedButton
        label={t('blueskyConnect.cancel')}
        variant="secondary"
        fullWidth
        onPress={() => {
          router.back();
        }}
      />
    </View>
  );
}

function GateScreen({
  message,
  onCreatePage,
}: {
  readonly message: string;
  readonly onCreatePage: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar
        title={t('blueskyConnect.cancel')}
        onPress={() => {
          router.back();
        }}
      />
      <SettingsScreenTitle title={t('blueskyConnect.title')} />
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
          {message}
        </ThemedText>
        <ThemedButton
          label={t('blueskyConnect.createPage')}
          variant="primary"
          onPress={onCreatePage}
        />
      </View>
    </View>
  );
}

function errorCopyKey(kind: BlueskyWizardErrorKind): string {
  switch (kind) {
    case 'invalidHandle':
      return 'blueskyConnect.error.invalidHandle';
    case 'oauthCancelled':
      return 'blueskyConnect.error.oauthCancelled';
    case 'clientMetadataUnavailable':
      return 'blueskyConnect.error.clientMetadataUnavailable';
    case 'networkUnavailable':
      return 'blueskyConnect.error.networkUnavailable';
    case 'profileMissing':
      return 'blueskyConnect.error.profileMissing';
    case 'profileSaveFailed':
      return 'blueskyConnect.error.profileSaveFailed';
    case 'recordWriteFailed':
      return 'blueskyConnect.error.recordWriteFailed';
    case 'identityResolutionFailed':
    case 'sessionIdentityMismatch':
      return 'blueskyConnect.error.identityMismatch';
    case 'verificationFailed':
      return 'blueskyConnect.error.verificationFailed';
    case 'oauthFailed':
      return 'blueskyConnect.error.oauthFailed';
  }
}
