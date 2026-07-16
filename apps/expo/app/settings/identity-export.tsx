/**
 * Identity Export/Import — free App<->Web portability for the seed-derived
 * root identity (04-plan Phase A1 task A1.4, `src/identity/rootKey.ts`).
 *
 * NOT the same identity as `/settings/dids` (SpruceID-managed device key) —
 * see rootKey.ts's module doc for the coexistence note. This screen is
 * additive; it does not touch the device key.
 *
 * Export: Face ID -> reveal the 24-word mnemonic + a screenshot warning.
 * Import: paste a mnemonic -> derive its did -> if it differs from the
 * current root, confirm before switching (same mnemonic re-import is a
 * silent no-op, matching rootKey.ts's idempotent `importFromMnemonic`).
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  clearSyncedRootKey,
  deriveDidFromMnemonic,
  getRootDid,
  importFromMnemonic,
  revealMnemonicForExport,
} from '@/identity';
import { usePreferences } from '@/settings/preferences';

export default function IdentityExportSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const setPref = usePreferences((s) => s.set);

  const [currentDid, setCurrentDid] = useState<string | null>(null);
  const [revealedWords, setRevealedWords] = useState<readonly string[] | null>(null);
  const [revealing, setRevealing] = useState(false);

  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getRootDid().then((r) => {
      if (!cancelled && r.ok) setCurrentDid(r.value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onExport = async () => {
    setRevealing(true);
    try {
      const r = await revealMnemonicForExport();
      if (!r.ok) {
        if (r.error.kind === 'notProvisioned') {
          pushToast(t('identityExport.noRootKey'), 'info');
        } else if (r.error.kind !== 'biometricDenied') {
          pushToast(t('identityExport.exportFailed'), 'error');
        }
        return;
      }
      setRevealedWords(r.value.split(' '));
    } finally {
      setRevealing(false);
    }
  };

  const onImport = async () => {
    const trimmed = importText.trim();
    if (trimmed.length === 0) return;
    setImportError(null);

    const derived = deriveDidFromMnemonic(trimmed);
    if (!derived.ok) {
      setImportError(t('identityExport.invalidPhrase'));
      return;
    }

    if (currentDid && currentDid !== derived.value) {
      const proceed = await confirmDialog({
        title: t('identityExport.switchConfirm.title'),
        message: t('identityExport.switchConfirm.message'),
        confirmLabel: t('identityExport.switchConfirm.confirm'),
        destructive: true,
      });
      if (!proceed) return;
    }

    setImporting(true);
    try {
      const r = await importFromMnemonic(trimmed);
      if (!r.ok) {
        // deriveDidFromMnemonic already validated the phrase above, so a
        // failure here can only be a storage-layer error, not a bad phrase.
        pushToast(t('identityExport.importFailed'), 'error');
        return;
      }
      if (currentDid && currentDid !== r.value.did) {
        // A different identity is now active — the prior iCloud/mnemonic
        // backup consent described the OLD key, not this one.
        setPref('rootKeySyncChoice', 'undecided');
        // Clear the OLD phrase from iCloud Keychain so another device can't
        // restoreRootKeyFromICloud the stale identity. Surface a conflict if the
        // clear fails rather than leaving a stale synced phrase behind (plan T6).
        const cleared = await clearSyncedRootKey();
        if (!cleared.ok) {
          pushToast(t('identityExport.staleSyncWarning'), 'error');
        }
      }
      setCurrentDid(r.value.did);
      setImportText('');
      pushToast(
        currentDid === r.value.did ? t('identityExport.alreadyActive') : t('identityExport.switched'),
        'success'
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('identityExport.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          <SettingsBlockSection title={t('identityExport.section.current')}>
            <SettingsBlockInfoRow
              icon="key.horizontal"
              title={t('identityExport.activeDid')}
              value={currentDid ? `${currentDid.slice(0, 18)}…` : t('identityExport.none')}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('identityExport.section.export')} footer={t('identityExport.exportFooter')}>
            {revealedWords ? (
              <View style={{ gap: 12, paddingHorizontal: 2 }}>
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: `${Colors.destructive}66`,
                    backgroundColor: `${Colors.destructive}14`,
                    padding: 12,
                  }}
                >
                  <ThemedText variant="caption" tone="error">
                    {t('identityExport.screenshotWarning')}
                  </ThemedText>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {revealedWords.map((word, i) => (
                    <View key={`${word}-${String(i)}`} style={{ width: '30%', flexDirection: 'row', gap: 4 }}>
                      <ThemedText variant="caption" tone="secondary">{`${String(i + 1)}.`}</ThemedText>
                      <ThemedText variant="bodySmall" style={{ fontFamily: 'Menlo' }}>
                        {word}
                      </ThemedText>
                    </View>
                  ))}
                </View>
                <ThemedButton
                  label={t('identityExport.hide')}
                  variant="secondary"
                  fullWidth
                  onPress={() => {
                    setRevealedWords(null);
                  }}
                />
              </View>
            ) : (
              <ThemedButton
                label={t('identityExport.reveal')}
                variant="primary"
                fullWidth
                loading={revealing}
                onPress={() => {
                  void onExport();
                }}
              />
            )}
          </SettingsBlockSection>

          <SettingsBlockSection title={t('identityExport.section.import')} footer={t('identityExport.importFooter')}>
            <View style={{ gap: 8, paddingHorizontal: 2 }}>
              <TextInput
                value={importText}
                onChangeText={(text) => {
                  setImportError(null);
                  setImportText(text);
                }}
                placeholder={t('identityExport.pastePlaceholder')}
                placeholderTextColor={Colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                className="bg-searchBg text-text1"
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 14,
                  fontFamily: 'Menlo',
                  minHeight: 88,
                  borderWidth: 1,
                  borderColor: importError ? Colors.destructive : Colors.divider,
                  textAlignVertical: 'top',
                }}
              />
              {importError ? (
                <ThemedText variant="caption" tone="error">
                  {importError}
                </ThemedText>
              ) : null}
              <ThemedButton
                label={t('identityExport.import')}
                variant="secondary"
                fullWidth
                loading={importing}
                disabled={importText.trim().length === 0}
                onPress={() => {
                  void onImport();
                }}
              />
            </View>
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
