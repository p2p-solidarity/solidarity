/**
 * BackupStep — onboarding root-key backup consent, non-skippable
 * (04-plan Phase A1 task A1.4). Wired as the `'backup'` onboarding step,
 * immediately after `'secureKeys'` — see `src/onboarding/state.ts`.
 *
 * NOTE on file location: the 04-plan brief names this file
 * `app/onboarding/backup.tsx`. Every existing onboarding step body lives
 * under `src/onboarding/steps/` and is wired into the single Expo Router
 * route `app/onboarding/index.tsx` via a switch (see that file) — there is
 * no per-step file under `app/onboarding/`. This file follows that
 * established convention instead of the brief's literal path, so it does
 * not register a second, effectively-dead `/onboarding/backup` route.
 *
 * This screen owns the seed-derived root identity's FIRST provisioning
 * (`createFromFreshMnemonic()` from `src/identity/rootKey.ts`) — a
 * DIFFERENT identity than the SpruceID-managed device key `secureKeys`
 * just generated; see rootKey.ts's module doc for why the two coexist.
 *
 * Flow:
 *   1. On mount, provision the root key if one doesn't already exist
 *      (idempotent — replaying onboarding, e.g. via Settings › Replay
 *      Onboarding, must not rotate an existing identity).
 *   2. Main question renders both options on iOS: "Use iCloud Keychain"
 *      (one-tap, real sync — task A1.5) and "Write down my recovery
 *      phrase". Android has no iCloud Keychain, so only the mnemonic
 *      option renders there (`secrets-vault`'s synchronizable-item calls
 *      unconditionally reject on Android — see that module's doc — so the
 *      option is never offered rather than offered-and-always-fails).
 *      Accepting iCloud calls `enableICloudBackup()` (`rootKey.ts`), which
 *      writes the ALREADY-PROVISIONED mnemonic into a real iCloud-
 *      Keychain-synchronizable item. `rootKeySyncChoice` is only set to
 *      `'icloud'` AFTER that write resolves `ok(...)` — never on tap alone
 *      (CLAUDE.md rule 8, no fake data). On failure, the mnemonic ceremony
 *      runs instead so the user always leaves this step with a completed
 *      backup.
 *   3. The mnemonic ceremony: show the 24 words with a screenshot warning,
 *      then re-enter 3 randomly-chosen words to prove the user actually
 *      recorded them. On REPLAY (root key already provisioned, so the
 *      effect below never populated `mnemonicWords`), the words are
 *      fetched on demand via the Face-ID-gated `revealMnemonicForExport`
 *      — see `backupStepLogic.ts`'s `resolveMnemonicForCeremony`.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, TextInput, View } from 'react-native';

import { ThemedButton, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import {
  createFromFreshMnemonic,
  deriveDidFromMnemonic,
  enableICloudBackup,
  hasRootKey,
  importFromMnemonic,
  restoreRootKeyFromICloud,
  revealMnemonicForExport,
} from '@/identity';
import { usePreferences } from '@/settings/preferences';
import {
  resolveIcloudAcceptOutcome,
  resolveMnemonicForCeremony,
  resolvePhraseImportOutcome,
  resolveRecoveryDecision,
} from './backupStepLogic';
import { OnboardingScaffold } from './OnboardingScaffold';

/** Android has no iCloud Keychain — the option is never offered there
 * rather than offered-and-guaranteed-to-fail (see module doc). */
const SUPPORTS_ICLOUD_BACKUP = Platform.OS === 'ios';

export interface BackupStepProps {
  readonly onBack: () => void;
  readonly onDone: () => void;
}

type Phase =
  | 'loading'
  | 'error'
  | 'question'
  | 'reveal'
  | 'confirm'
  | 'recoveryFailed'
  | 'enterPhrase';

const CONFIRM_WORD_COUNT = 3;

/** Pick `count` distinct indices in `[0, total)`, ascending. */
function pickConfirmIndices(total: number, count: number): readonly number[] {
  const pool = Array.from({ length: total }, (_, i) => i);
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked.sort((a, b) => a - b);
}

export function BackupStep({ onBack, onDone }: BackupStepProps) {
  const { t } = useTranslation();
  const setPref = usePreferences((s) => s.set);
  const [phase, setPhase] = useState<Phase>('loading');
  const [mnemonicWords, setMnemonicWords] = useState<readonly string[]>([]);
  const confirmIndices = useMemo(
    () => (mnemonicWords.length > 0 ? pickConfirmIndices(mnemonicWords.length, CONFIRM_WORD_COUNT) : []),
    [mnemonicWords]
  );
  const [confirmInputs, setConfirmInputs] = useState<Readonly<Record<number, string>>>({});
  const [confirmError, setConfirmError] = useState(false);
  // Only set while resolving the mnemonic-ceremony words on the REPLAY path
  // (Face-ID-gated reveal) — the fresh-provisioning path already has the
  // words in hand and never touches this.
  const [revealingForCeremony, setRevealingForCeremony] = useState(false);
  // Only set while the real iCloud Keychain write is in flight.
  const [icloudSubmitting, setIcloudSubmitting] = useState(false);
  // Recovery-failure "Enter recovery phrase" leg (in-memory only, cleared on
  // success/leave — never logged or persisted outside the keychain import).
  const [phraseInput, setPhraseInput] = useState('');
  const [phraseError, setPhraseError] = useState(false);
  const [phraseImporting, setPhraseImporting] = useState(false);
  // Retry re-runs the provisioning effect (its deps otherwise never change —
  // a phase flip alone left the spinner stuck forever). Safe to re-run: the
  // effect's hasRootKey() check keeps provisioning idempotent.
  const [provisionNonce, setProvisionNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const provision = async () => {
      // Idempotent: replaying onboarding with an already-provisioned root
      // must not mint (and silently rotate to) a new mnemonic.
      if (await hasRootKey()) {
        if (!cancelled) setPhase('question');
        return;
      }
      // Last-chance recovery before minting fresh: the iCloud-synced Recovery
      // Phrase may have arrived since SecureKeysStep ran (Keychain sync is
      // async). Never mint a new identity over a backed-up one. Local-wins in
      // restoreRootKeyFromICloud guarantees this only imports when nothing is
      // local, so it can't silently switch an existing identity.
      // A FAILED read (keychain error, corrupt synced phrase) must not fall
      // through to a silent fresh mint either — the user chooses (user
      // decision 2026-07-17, extended 2026-07-24 to the three options the
      // rootKey.ts contract names: retry / enter phrase / start fresh). The
      // 'recoveryFailed' phase renders those choices; never auto-mint here.
      if (Platform.OS === 'ios') {
        const decision = resolveRecoveryDecision(await restoreRootKeyFromICloud());
        if (cancelled) return;
        if (decision.kind === 'recovered') {
          // Recovered a backed-up identity → they already use iCloud backup.
          setPref('rootKeySyncChoice', 'icloud');
          onDone();
          return;
        }
        if (decision.kind === 'askUser') {
          setPhase('recoveryFailed');
          return;
        }
        // decision.kind === 'mintFresh' (authoritative notFound) → mint below.
      }
      const created = await createFromFreshMnemonic();
      if (cancelled) return;
      if (!created.ok) {
        showError({
          context: 'Onboarding › Backup',
          summary: t('backupStep.provisionFailed'),
          error: new Error(created.error.kind),
        });
        setPhase('error');
        return;
      }
      setMnemonicWords(created.value.mnemonic.split(' '));
      setPhase('question');
    };
    void provision();
    return () => {
      cancelled = true;
    };
  }, [provisionNonce, t]);

  const declineToMnemonic = async () => {
    setRevealingForCeremony(true);
    try {
      const outcome = await resolveMnemonicForCeremony(mnemonicWords, revealMnemonicForExport);
      if (outcome.kind === 'error') {
        // Replay path, Face ID gate failed (denied) or storage errored —
        // never a silent no-op; the user needs to know why nothing moved.
        showError({
          context: 'Onboarding › Backup',
          summary: t('backupStep.revealFailed'),
          error: new Error(outcome.error.kind),
        });
        return;
      }
      if (mnemonicWords.length === 0) setMnemonicWords(outcome.words);
      setPhase('reveal');
    } finally {
      setRevealingForCeremony(false);
    }
  };

  /**
   * Real iCloud Keychain write (`rootKey.ts`'s `enableICloudBackup`).
   * `rootKeySyncChoice` is only recorded AFTER the write resolves `ok(...)`
   * — never on tap alone (CLAUDE.md rule 8, no fake data). On failure this
   * falls back to the mnemonic ceremony so the user always leaves this step
   * with a completed, real backup rather than stuck on an error.
   */
  const acceptICloud = async () => {
    setIcloudSubmitting(true);
    try {
      const outcome = await resolveIcloudAcceptOutcome(enableICloudBackup);
      if (outcome.kind === 'error') {
        showError({
          context: 'Onboarding › Backup',
          summary: t('backupStep.icloudFailed'),
          error: new Error(outcome.error.kind),
        });
        await declineToMnemonic();
        return;
      }
      haptic('success');
      setPref('rootKeySyncChoice', 'icloud');
      onDone();
    } finally {
      setIcloudSubmitting(false);
    }
  };

  /** Re-run the provisioning effect — re-attempts the iCloud recovery read. */
  const retryRecovery = () => {
    setPhase('loading');
    setProvisionNonce((value) => value + 1);
  };

  /**
   * Mint a brand-new identity. Reached ONLY from the double-confirmed Start
   * Fresh button below — never auto-invoked (mirrors the effect's fresh-mint
   * tail). Biometric semantics unchanged: minting itself is not Face-ID-gated.
   */
  const mintFreshRootKey = async () => {
    const created = await createFromFreshMnemonic();
    if (!created.ok) {
      showError({
        context: 'Onboarding › Backup',
        summary: t('backupStep.provisionFailed'),
        error: new Error(created.error.kind),
      });
      setPhase('error');
      return;
    }
    setMnemonicWords(created.value.mnemonic.split(' '));
    setPhase('question');
  };

  /**
   * Start Fresh — destructive and double-confirmed (this handler is the first
   * deliberate act, `confirmDialog` the second). Kept LAST in the choice list.
   */
  const startFreshFromRecovery = async () => {
    const confirmed = await confirmDialog({
      title: t('backupStep.cloudReadFailed.title'),
      message: t('backupStep.cloudReadFailed.message'),
      confirmLabel: t('backupStep.cloudReadFailed.startFresh'),
      cancelLabel: t('alert.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    setPhase('loading');
    await mintFreshRootKey();
  };

  /** Leave the enter-phrase screen, wiping the in-memory phrase + error. */
  const leaveEnterPhrase = (next: Phase) => {
    setPhraseInput('');
    setPhraseError(false);
    setPhase(next);
  };

  /**
   * Enter-recovery-phrase leg: reuse the EXISTING derive + import path. On
   * success this is the same terminal effect as the `recovered` path — record
   * the (mnemonic-only) backup choice and advance. A bad phrase shows an
   * inline field error, never a silent no-op.
   */
  const submitPhrase = async () => {
    setPhraseImporting(true);
    try {
      const outcome = await resolvePhraseImportOutcome(
        phraseInput,
        deriveDidFromMnemonic,
        importFromMnemonic
      );
      if (outcome.kind === 'invalid') {
        haptic('error');
        setPhraseError(true);
        return;
      }
      if (outcome.kind === 'error') {
        showError({
          context: 'Onboarding › Backup',
          summary: t('backupStep.enterPhrase.importFailed'),
          error: new Error(outcome.error.kind),
        });
        return;
      }
      haptic('success');
      setPhraseInput('');
      // Manually-entered phrase → the user holds it outside iCloud.
      setPref('rootKeySyncChoice', 'mnemonicOnly');
      onDone();
    } finally {
      setPhraseImporting(false);
    }
  };

  const confirmWordsMatch = (): boolean =>
    confirmIndices.every((idx) => {
      const expected = mnemonicWords[idx]?.trim().toLowerCase();
      const got = confirmInputs[idx]?.trim().toLowerCase();
      return expected !== undefined && got === expected;
    });

  const submitConfirm = () => {
    if (!confirmWordsMatch()) {
      haptic('error');
      setConfirmError(true);
      return;
    }
    haptic('success');
    setPref('rootKeySyncChoice', 'mnemonicOnly');
    onDone();
  };

  if (phase === 'loading') {
    return (
      <OnboardingScaffold onBack={onBack} title={t('backupStep.title')} subtitle={t('backupStep.subtitle')}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.terminalGreen} />
        </View>
      </OnboardingScaffold>
    );
  }

  if (phase === 'error') {
    return (
      <OnboardingScaffold onBack={onBack} title={t('backupStep.title')} subtitle={t('backupStep.subtitle')}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <ThemedText variant="bodyMedium" tone="secondary">
            {t('backupStep.provisionFailed')}
          </ThemedText>
          <ThemedButton
            label={t('backupStep.retry')}
            variant="secondary"
            onPress={() => {
              setPhase('loading');
              setProvisionNonce((value) => value + 1);
            }}
          />
        </View>
      </OnboardingScaffold>
    );
  }

  if (phase === 'question') {
    return (
      <OnboardingScaffold
        onBack={onBack}
        title={t('backupStep.title')}
        subtitle={t(SUPPORTS_ICLOUD_BACKUP ? 'backupStep.subtitle' : 'backupStep.subtitleMnemonicOnly')}
        footer={
          <View style={{ gap: 12 }}>
            {SUPPORTS_ICLOUD_BACKUP ? (
              <ThemedButton
                label={t('backupStep.useICloud')}
                variant="inverted"
                fullWidth
                loading={icloudSubmitting}
                disabled={revealingForCeremony}
                onPress={() => {
                  void acceptICloud();
                }}
              />
            ) : null}
            <ThemedButton
              label={t('backupStep.useMnemonic')}
              variant="dottedOutline"
              fullWidth
              loading={revealingForCeremony}
              disabled={icloudSubmitting}
              onPress={() => {
                void declineToMnemonic();
              }}
            />
          </View>
        }
      >
        <View style={{ flex: 1 }} />
        {SUPPORTS_ICLOUD_BACKUP ? (
          <ThemedText variant="bodySmall" tone="secondary">
            {t('backupStep.icloudExplainer')}
          </ThemedText>
        ) : null}
        <View style={{ flex: 1 }} />
      </OnboardingScaffold>
    );
  }

  if (phase === 'recoveryFailed') {
    return (
      <OnboardingScaffold
        onBack={onBack}
        title={t('backupStep.cloudReadFailed.title')}
        subtitle={t('backupStep.cloudReadFailed.message')}
        footer={
          <View style={{ gap: 12 }}>
            <ThemedButton
              label={t('backupStep.cloudReadFailed.retry')}
              variant="inverted"
              fullWidth
              onPress={retryRecovery}
            />
            <ThemedButton
              label={t('backupStep.cloudReadFailed.enterPhrase')}
              variant="dottedOutline"
              fullWidth
              onPress={() => {
                leaveEnterPhrase('enterPhrase');
              }}
            />
            <ThemedButton
              label={t('backupStep.cloudReadFailed.startFresh')}
              variant="destructive"
              fullWidth
              onPress={() => {
                void startFreshFromRecovery();
              }}
            />
          </View>
        }
      >
        <View style={{ flex: 1 }} />
      </OnboardingScaffold>
    );
  }

  if (phase === 'enterPhrase') {
    return (
      <OnboardingScaffold
        onBack={() => {
          leaveEnterPhrase('recoveryFailed');
        }}
        title={t('backupStep.enterPhrase.title')}
        subtitle={t('backupStep.enterPhrase.message')}
        footer={
          <ThemedButton
            label={t('backupStep.enterPhrase.action')}
            variant="inverted"
            fullWidth
            loading={phraseImporting}
            disabled={phraseInput.trim().length === 0}
            onPress={() => {
              void submitPhrase();
            }}
          />
        }
      >
        <ThemedTextInput
          kind="did"
          multiline
          autoFocus
          value={phraseInput}
          onChangeText={(text) => {
            setPhraseError(false);
            setPhraseInput(text);
          }}
          placeholder={t('backupStep.enterPhrase.placeholder')}
          error={phraseError ? t('backupStep.enterPhrase.invalid') : null}
          accessibilityLabel={t('backupStep.enterPhrase.title')}
        />
      </OnboardingScaffold>
    );
  }

  if (phase === 'reveal') {
    return (
      <OnboardingScaffold
        onBack={() => {
          setPhase('question');
        }}
        title={t('backupStep.revealTitle')}
        subtitle={t('backupStep.revealSubtitle')}
        footer={
          <ThemedButton
            label={t('onboarding.continue')}
            variant="inverted"
            fullWidth
            onPress={() => {
              setPhase('confirm');
            }}
          />
        }
      >
        <View style={{ gap: 16 }}>
          <View
            style={{
              borderWidth: 1,
              borderColor: `${Colors.destructive}66`,
              backgroundColor: `${Colors.destructive}14`,
              padding: 12,
            }}
          >
            <ThemedText variant="caption" tone="error">
              {t('backupStep.screenshotWarning')}
            </ThemedText>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {mnemonicWords.map((word, i) => (
              <View
                key={`${word}-${String(i)}`}
                style={{ width: '30%', flexDirection: 'row', gap: 4 }}
              >
                <ThemedText variant="caption" tone="secondary">{`${String(i + 1)}.`}</ThemedText>
                <ThemedText variant="bodySmall" style={{ fontFamily: 'Menlo' }}>
                  {word}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      </OnboardingScaffold>
    );
  }

  // phase === 'confirm'
  return (
    <OnboardingScaffold
      onBack={() => {
        setConfirmError(false);
        setPhase('reveal');
      }}
      title={t('backupStep.confirmTitle')}
      subtitle={t('backupStep.confirmSubtitle')}
      footer={
        <ThemedButton label={t('backupStep.confirmAction')} variant="inverted" fullWidth onPress={submitConfirm} />
      }
    >
      <View style={{ gap: 16 }}>
        {confirmIndices.map((idx) => (
          <View key={idx} style={{ gap: 6 }}>
            <ThemedText variant="label">{t('backupStep.wordN', { n: idx + 1 })}</ThemedText>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              value={confirmInputs[idx] ?? ''}
              onChangeText={(text) => {
                setConfirmError(false);
                setConfirmInputs((prev) => ({ ...prev, [idx]: text }));
              }}
              className="bg-searchBg text-text1"
              style={{
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                fontFamily: 'Menlo',
                borderWidth: 1,
                borderColor: confirmError ? Colors.destructive : Colors.divider,
              }}
            />
          </View>
        ))}
        {confirmError ? (
          <ThemedText variant="caption" tone="error">
            {t('backupStep.confirmMismatch')}
          </ThemedText>
        ) : null}
      </View>
    </OnboardingScaffold>
  );
}
