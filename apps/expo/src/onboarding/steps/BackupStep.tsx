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
 *   2. Main question: "Back up your key with iCloud?" — ONE tap,
 *      recommended. Accepting records the user's INTENT
 *      (`rootKeySyncChoice`) and completes immediately; the mnemonic
 *      ceremony is entirely skipped on this path.
 *   3. Declining opens the mnemonic ceremony: show the 24 words with a
 *      screenshot warning, then re-enter 3 randomly-chosen words to prove
 *      the user actually recorded them. **This ceremony only appears on
 *      the decline path.**
 *
 * NOTE on "iCloud backup": today this records intent only — the mnemonic
 * itself is stored device-local (see rootKey.ts's module doc: `expo-secure-
 * store` has no `kSecAttrSynchronizable` option). We deliberately never
 * show a "synced ✓" state here — only the recommendation copy — since we
 * cannot yet prove sync happened (CLAUDE.md rule 8, no fake data).
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import { createFromFreshMnemonic, hasRootKey } from '@/identity';
import { usePreferences } from '@/settings/preferences';
import { OnboardingScaffold } from './OnboardingScaffold';

export interface BackupStepProps {
  readonly onBack: () => void;
  readonly onDone: () => void;
}

type Phase = 'loading' | 'error' | 'question' | 'reveal' | 'confirm';

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

  useEffect(() => {
    let cancelled = false;
    const provision = async () => {
      // Idempotent: replaying onboarding with an already-provisioned root
      // must not mint (and silently rotate to) a new mnemonic.
      if (await hasRootKey()) {
        if (!cancelled) setPhase('question');
        return;
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
  }, [t]);

  const acceptICloud = () => {
    haptic('success');
    setPref('rootKeySyncChoice', 'icloud');
    onDone();
  };

  const declineToMnemonic = () => {
    if (mnemonicWords.length === 0) return;
    setPhase('reveal');
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
        subtitle={t('backupStep.subtitle')}
        footer={
          <View style={{ gap: 12 }}>
            <ThemedButton label={t('backupStep.useICloud')} variant="inverted" fullWidth onPress={acceptICloud} />
            <ThemedButton
              label={t('backupStep.useMnemonic')}
              variant="dottedOutline"
              fullWidth
              onPress={declineToMnemonic}
            />
          </View>
        }
      >
        <View style={{ flex: 1 }} />
        <ThemedText variant="bodySmall" tone="secondary">
          {t('backupStep.icloudExplainer')}
        </ThemedText>
        <View style={{ flex: 1 }} />
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
