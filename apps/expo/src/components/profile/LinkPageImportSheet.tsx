/**
 * LinkPageImportSheet — the shared "paste a link page, preview, pick which
 * links to keep" flow behind BOTH Task A2.4 entry points (US-19):
 *   - Me › Edit's 「從 Linktree 匯入」 (merges checked links into the
 *     profile editor's local `links[]` rows; the user still presses the
 *     normal Save (Face ID) to persist — this sheet never saves anything
 *     itself).
 *   - People tab's 「貼上連結頁」 (saves a `kind: 'declared'` snapshot via
 *     `profileSnapshots.ts`'s `upsertDeclared`).
 *
 * Both callers get the identical fetch/preview/checklist UX (one
 * implementation, CLAUDE.md rule 1 — no dup) and only differ in the sheet
 * title, confirm-button label, and what `onImport` does with the result —
 * this component never calls either persistence path itself.
 *
 * Every extracted link is inherently an unverified CLAIM (it's scraped
 * text from a public page, not a cryptographic proof) — CLAUDE.md rule 8 —
 * so every checklist row carries a visible 「宣稱」 chip; there is no
 * "verified" state this sheet can ever show. All links start checked
 * (the common case: import everything), since the checklist exists to let
 * the user DESELECT junk, not to make them hunt for an "all" toggle.
 *
 * Content only renders while `visible` (matching
 * `VerifiedPageResultSheet`'s pattern, not `ManualContactEntrySheet`'s
 * always-mounted one) — a fresh URL input is what "open the sheet again"
 * should mean, unlike a contact-entry draft worth preserving.
 */
import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  fetchLinkPage,
  type LinkPageImportErrorReason,
  type LinkPageLink,
} from '@/profile/linktreeImport';

export interface LinkPageImportResult {
  readonly sourceUrl: string;
  readonly title: string | null;
  readonly links: readonly LinkPageLink[];
}

export interface LinkPageImportSheetProps {
  readonly visible: boolean;
  /** Sheet header — caller-specific ("從 Linktree 匯入" vs "貼上連結頁"). */
  readonly title: string;
  /** Confirm CTA label — caller-specific ("加入所選連結" vs "儲存為聯絡人"). */
  readonly confirmLabel: string;
  readonly onClose: () => void;
  /** Fires with the CHECKED links only. Caller decides what "import" means. */
  readonly onImport: (result: LinkPageImportResult) => void;
}

type Phase =
  | { readonly step: 'input' }
  | { readonly step: 'loading' }
  | {
      readonly step: 'preview';
      readonly sourceUrl: string;
      readonly title: string | null;
      readonly links: readonly LinkPageLink[];
      readonly checked: ReadonlySet<string>;
    }
  | { readonly step: 'error'; readonly reason: LinkPageImportErrorReason };

export function LinkPageImportSheet({
  visible,
  title,
  confirmLabel,
  onClose,
  onImport,
}: LinkPageImportSheetProps): ReactNode {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? (
        <LinkPageImportSheetContent
          sheetTitle={title}
          confirmLabel={confirmLabel}
          onClose={onClose}
          onImport={onImport}
        />
      ) : null}
    </Modal>
  );
}

function LinkPageImportSheetContent({
  sheetTitle,
  confirmLabel,
  onClose,
  onImport,
}: {
  readonly sheetTitle: string;
  readonly confirmLabel: string;
  readonly onClose: () => void;
  readonly onImport: (result: LinkPageImportResult) => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ step: 'input' });

  const runFetch = (): void => {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;
    setPhase({ step: 'loading' });
    void fetchLinkPage(trimmed).then((result) => {
      if (!result.ok) {
        setPhase({ step: 'error', reason: result.error });
        return;
      }
      setPhase({
        step: 'preview',
        sourceUrl: trimmed,
        title: result.value.title,
        links: result.value.links,
        checked: new Set(result.value.links.map((l) => l.url)),
      });
    });
  };

  const toggleChecked = (linkUrl: string): void => {
    setPhase((prev) => {
      if (prev.step !== 'preview') return prev;
      const next = new Set(prev.checked);
      if (next.has(linkUrl)) next.delete(linkUrl);
      else next.add(linkUrl);
      return { ...prev, checked: next };
    });
  };

  const confirm = (): void => {
    if (phase.step !== 'preview') return;
    const selected = phase.links.filter((l) => phase.checked.has(l.url));
    if (selected.length === 0) return;
    onImport({ sourceUrl: phase.sourceUrl, title: phase.title, links: selected });
    onClose();
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.pageBg, paddingTop: insets.top }}>
      <Toolbar title={sheetTitle} onCancel={onClose} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        {phase.step !== 'preview' ? (
          <View style={{ gap: 8 }}>
            <ThemedText variant="label">{t('linkPageImport.urlLabel')}</ThemedText>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder={t('linkPageImport.urlPlaceholder')}
              placeholderTextColor={Colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={phase.step !== 'loading'}
              className="bg-searchBg text-text1"
              style={{
                paddingHorizontal: 14,
                paddingVertical: 14,
                fontSize: 15,
                borderWidth: 1,
                borderColor: Colors.divider,
              }}
            />
          </View>
        ) : null}

        {phase.step === 'error' ? (
          <View className="gap-3 rounded-xl border border-divider p-4">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <SfIcon name="xmark.seal.fill" size={18} color={Colors.destructive} />
              <ThemedText variant="titleMedium" style={{ color: Colors.destructive }}>
                {t('linkPageImport.errorTitle')}
              </ThemedText>
            </View>
            <ThemedText variant="bodyMedium" tone="secondary">
              {t(`linkPageImport.reason.${phase.reason}`)}
            </ThemedText>
          </View>
        ) : null}

        {phase.step === 'preview' ? (
          <View style={{ gap: 12 }}>
            {phase.title ? (
              <ThemedText variant="titleMedium" numberOfLines={2}>
                {phase.title}
              </ThemedText>
            ) : null}
            <ThemedText variant="caption" tone="tertiary">
              {t('linkPageImport.selectedCount', { count: phase.checked.size, total: phase.links.length })}
            </ThemedText>
            <View style={{ gap: 8 }}>
              {phase.links.map((link) => (
                <ChecklistRow
                  key={link.url}
                  link={link}
                  checked={phase.checked.has(link.url)}
                  onToggle={() => { toggleChecked(link.url); }}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 12 }}>
        {phase.step === 'preview' ? (
          <ThemedButton
            fullWidth
            label={confirmLabel}
            disabled={phase.checked.size === 0}
            onPress={confirm}
          />
        ) : (
          <ThemedButton
            fullWidth
            loading={phase.step === 'loading'}
            disabled={url.trim().length === 0}
            label={phase.step === 'error' ? t('linkPageImport.retry') : t('linkPageImport.fetch')}
            onPress={runFetch}
          />
        )}
      </View>
    </View>
  );
}

function ChecklistRow({
  link,
  checked,
  onToggle,
}: {
  readonly link: LinkPageLink;
  readonly checked: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <PressableScale
      haptic="tap"
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={link.label.length > 0 ? link.label : link.url}
      className="flex-row items-center gap-3 rounded-lg border border-divider p-3"
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: checked ? Colors.accentRose : Colors.text3,
          backgroundColor: checked ? Colors.accentRose : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <SfIcon name="checkmark" size={12} color={Colors.invertedButtonText} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="bodyMedium" numberOfLines={1}>
          {link.label.length > 0 ? link.label : link.url}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {link.url}
        </ThemedText>
      </View>
      <View className="rounded-full border border-divider px-2 py-0.5" style={{ borderStyle: 'dashed' }}>
        <ThemedText variant="caption" tone="tertiary">
          {t('linkPageImport.claimedChip')}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

function Toolbar({ title, onCancel }: { readonly title: string; readonly onCancel: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 16, height: 44 }}>
      <PressableScale
        haptic="tap"
        onPress={onCancel}
        accessibilityRole="button"
        style={{ width: 60, height: 44, justifyContent: 'center' }}
      >
        <ThemedText variant="bodyMedium">{t('linkPageImport.cancel')}</ThemedText>
      </PressableScale>
      <ThemedText variant="titleMedium">{title}</ThemedText>
      <View style={{ width: 60, height: 44 }} />
    </View>
  );
}
