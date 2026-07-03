/**
 * CompleteStep — 1.3.3 Task A2.5 converged-flow summary. Was previously a
 * 1:1 port of Swift's `finalCompletionStep` (Profile/Key Pair/Contacts/
 * Passport rows, all hardcoded English); onboarding no longer collects a
 * legacy username or imports contacts/scans a passport by default (those
 * steps were dropped — see `src/onboarding/state.ts`'s module doc), so the
 * summary now reflects what this flow actually does: Key Pair → Backup →
 * Page. Each row's `done` state comes from a REAL source — reducer state,
 * `usePreferences`, or `useProfileStore` — never a guess (CLAUDE.md rule 8).
 *
 *   [ SYSTEM READY ]
 *
 *   ┌────────────────────────────┐
 *   │ ✓ Key Pair                 │
 *   │   Generated                │
 *   │ ✓ Backup                   │
 *   │   iCloud Keychain          │
 *   │ ✓ Page                     │
 *   │   Ada Lovelace             │
 *   └────────────────────────────┘
 *
 *   [ Start Using Solidarity ]   (inverted CTA)
 *
 * The "3 分鐘拿到 ≥1 綠勾" acceptance (a green verification badge) is not
 * shown here — badge verification lands with the Nostr path in Phase A4;
 * faking one here would violate CLAUDE.md rule 8.
 */
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';

export interface CompleteStepProps {
  readonly keysGenerated: boolean;
  readonly onFinish: () => void;
}

export function CompleteStep({ keysGenerated, onFinish }: CompleteStepProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const rootKeySyncChoice = usePreferences((s) => s.rootKeySyncChoice);
  const profileStatus = useProfileStore((s) => s.status);
  const record = useProfileStore((s) => s.record);

  const handleFinish = () => {
    haptic('success');
    onFinish();
  };

  const backupDone = rootKeySyncChoice !== 'undecided';
  const backupDetail =
    rootKeySyncChoice === 'icloud'
      ? t('completeStep.backupIcloud')
      : rootKeySyncChoice === 'mnemonicOnly'
        ? t('completeStep.backupMnemonic')
        : t('completeStep.backupNotSet');

  const pageDone = profileStatus === 'ready' && record !== null;
  const displayName = record?.displayName.trim() ?? '';
  const pageDetail = pageDone
    ? displayName.length > 0
      ? displayName
      : t('completeStep.pageCreated')
    : t('completeStep.pageSkipped');

  return (
    <View
      className="bg-pageBg flex-1"
      style={{
        paddingHorizontal: 24,
        paddingTop: insets.top + 56,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}
    >
      <View style={{ flex: 1 }} />

      <View style={{ alignItems: 'center' }}>
        <ThemedText
          variant="headlineLarge"
          style={{
            color: Colors.terminalGreen,
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            ...(Platform.OS === 'ios'
              ? { textShadowColor: `${Colors.terminalGreen}80`, textShadowRadius: 10 }
              : {}),
          }}
        >
          {t('completeStep.systemReady')}
        </ThemedText>
      </View>

      <View
        style={{
          padding: 16,
          backgroundColor: Colors.searchBg,
          borderWidth: 1,
          borderColor: Colors.divider,
          gap: 12,
        }}
      >
        <CompletionRow
          title={t('completeStep.keyPair')}
          done={keysGenerated}
          detail={keysGenerated ? t('completeStep.keyGenerated') : t('completeStep.keyNotCreated')}
        />
        <CompletionRow title={t('completeStep.backup')} done={backupDone} detail={backupDetail} />
        <CompletionRow title={t('completeStep.page')} done={pageDone} detail={pageDetail} />
      </View>

      <View style={{ flex: 1 }} />

      <ThemedButton
        label={t('completeStep.start')}
        variant="inverted"
        fullWidth
        haptic={false}
        onPress={handleFinish}
      />
    </View>
  );
}

function CompletionRow({
  title,
  done,
  detail,
}: {
  title: string;
  done: boolean;
  detail: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <SfIcon
        name={done ? 'checkmark.circle.fill' : 'circle'}
        size={18}
        color={done ? Colors.terminalGreen : Colors.text3}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText
          variant="bodySmall"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '600' }}
        >
          {title}
        </ThemedText>
        <ThemedText variant="caption" tone="secondary">
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}
