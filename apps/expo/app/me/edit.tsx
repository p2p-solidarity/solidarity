/**
 * Me › Edit — the Profile Record (01-spec §3) editor (1.3.3 Task A2.2).
 * Edits `displayName` / `bio` / `links` (add / remove / reorder rows, each
 * a label + URL pair); avatar upload is explicitly OUT of scope (CLAUDE.md
 * rule 8 — no fabricated field), so it isn't editable here.
 *
 * Save flow: client-side per-row link validation (reusing
 * `@solidarity/shared`'s `profileLinkSchema` directly, not a re-implemented
 * regex) blocks Save while any row is invalid; the actual submit goes
 * through `useProfileStore().saveProfile()`, which re-validates via
 * `parseProfile` BEFORE ever calling the Face-ID-gated signer (see
 * `src/profile/store.ts`'s module doc) and returns a `Result<void, string>`
 * this screen surfaces via `showError` — never a native `Alert.alert`.
 *
 * No provisioned root key → an honest "需要先完成身份設定" state with a CTA
 * into the existing onboarding replay flow (`/onboarding?replay=1`, the
 * same route `settings/index.tsx`'s "Replay Onboarding" row uses — its
 * non-skippable `BackupStep` is what actually provisions the root key).
 * This screen never mints a key itself.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { LinkPageImportSheet, type LinkPageImportResult } from '@/components/profile/LinkPageImportSheet';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import { useProfileStore } from '@/profile/store';
import { profileLinkSchema, uuid, type ProfileLink } from '@solidarity/shared';

interface EditableLink {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

function toEditableLink(link: ProfileLink): EditableLink {
  return { id: uuid(), label: link.label, url: link.url };
}

const linkUrlSchema = profileLinkSchema.shape.url;

/** `null` = no error. An empty (never-touched) URL is not an error — the
 * whole row is simply dropped from the saved payload (see `handleSave`'s
 * `submittedLinks` filter below). */
function validateLinkUrl(url: string): string | null {
  if (url.length === 0) return null;
  const result = linkUrlSchema.safeParse(url);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'invalid URL';
}

function isBlankLink(link: EditableLink): boolean {
  return link.label.trim().length === 0 && link.url.length === 0;
}

export default function MeEditScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const saveProfile = useProfileStore((s) => s.saveProfile);

  // Optimistic default — see `ProfileSummaryCard`'s doc for why (the common
  // case already has a provisioned root key; this flips to the honest
  // "needs setup" state only if a real check says otherwise).
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

  const [displayName, setDisplayName] = useState(record?.displayName ?? '');
  const [bio, setBio] = useState(record?.bio ?? '');
  const [links, setLinks] = useState<readonly EditableLink[]>(() => (record?.links ?? []).map(toEditableLink));
  const [saving, setSaving] = useState(false);
  const [linktreeSheetOpen, setLinktreeSheetOpen] = useState(false);

  const linkErrors = useMemo(() => links.map((l) => (isBlankLink(l) ? null : validateLinkUrl(l.url))), [links]);
  const hasLinkErrors = linkErrors.some((e) => e !== null);

  const addLink = () => {
    setLinks((prev) => [...prev, { id: uuid(), label: '', url: '' }]);
  };
  const removeLink = (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };
  const moveLink = (id: string, direction: -1 | 1) => {
    setLinks((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      const swapIdx = idx + direction;
      if (idx < 0 || swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      const a = next[idx];
      const b = next[swapIdx];
      if (!a || !b) return prev;
      next[idx] = b;
      next[swapIdx] = a;
      return next;
    });
  };
  const updateLink = (id: string, field: 'label' | 'url', value: string) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  /** Merges CHECKED imported links into the editable rows, deduped against
   * what's already here by url — never a silent overwrite, never a second
   * copy of a link the user already has. The user still has to press the
   * normal Save (Face ID) below; this only edits local draft state. */
  const mergeImportedLinks = (result: LinkPageImportResult) => {
    const existingUrls = new Set(links.map((l) => l.url));
    const additions = result.links
      .filter((l) => !existingUrls.has(l.url))
      .map((l) => ({ id: uuid(), label: l.label, url: l.url }));
    if (additions.length === 0) return;
    setLinks((prev) => [...prev, ...additions]);
    haptic('success');
    pushToast(t('meEdit.linktreeImportMerged', { count: additions.length }), 'success');
  };

  const handleSave = async () => {
    if (hasLinkErrors) {
      haptic('error');
      return;
    }
    setSaving(true);
    try {
      const submittedLinks: ProfileLink[] = links
        .filter((l) => !isBlankLink(l))
        .map((l) => ({ label: l.label.trim(), url: l.url }));

      const result = await saveProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        links: submittedLinks,
      });

      if (!result.ok) {
        haptic('error');
        showError({
          context: 'Me › Edit',
          summary: t('meEdit.saveFailed'),
          error: new Error(result.error),
        });
        return;
      }

      haptic('success');
      pushToast(t('meEdit.saved'), 'success');
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!rootKeyPresent) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <SettingsBackToolbar title={t('meEdit.cancel')} onPress={() => { router.back(); }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
          <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
            {t('profileCard.needsIdentitySetup')}
          </ThemedText>
          <ThemedButton
            label={t('profileCard.setUpIdentity')}
            variant="primary"
            onPress={() => { router.push('/onboarding?replay=1'); }}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('meEdit.cancel')} onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('meEdit.title')} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 48, gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <FieldBlock
          label={t('meEdit.displayName')}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('meEdit.displayNamePlaceholder')}
        />
        <FieldBlock
          label={t('meEdit.bio')}
          value={bio}
          onChangeText={setBio}
          placeholder={t('meEdit.bioPlaceholder')}
          multiline
        />

        <LinksEditor
          links={links}
          errors={linkErrors}
          onAdd={addLink}
          onRemove={removeLink}
          onMove={moveLink}
          onChangeField={updateLink}
          onImportLinktree={() => { setLinktreeSheetOpen(true); }}
        />

        <ThemedButton
          label={saving ? t('meEdit.saving') : t('meEdit.save')}
          variant="primary"
          fullWidth
          loading={saving}
          disabled={hasLinkErrors}
          onPress={() => { void handleSave(); }}
        />
      </ScrollView>

      <LinkPageImportSheet
        visible={linktreeSheetOpen}
        title={t('meEdit.importFromLinktree')}
        confirmLabel={t('meEdit.linktreeImportConfirm')}
        onClose={() => { setLinktreeSheetOpen(false); }}
        onImport={mergeImportedLinks}
      />
    </View>
  );
}

function FieldBlock({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (v: string) => void;
  readonly placeholder: string;
  readonly multiline?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <ThemedText variant="label">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.text3}
        multiline={multiline}
        className="bg-searchBg text-text1"
        style={{
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 14,
          fontSize: 15,
          minHeight: multiline ? 88 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      />
    </View>
  );
}

function LinksEditor({
  links,
  errors,
  onAdd,
  onRemove,
  onMove,
  onChangeField,
  onImportLinktree,
}: {
  readonly links: readonly EditableLink[];
  readonly errors: readonly (string | null)[];
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onChangeField: (id: string, field: 'label' | 'url', value: string) => void;
  readonly onImportLinktree: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      <View className="flex-row items-center justify-between">
        <ThemedText variant="label">{t('meEdit.links')}</ThemedText>
        <PressableScale
          haptic="tap"
          onPress={onImportLinktree}
          accessibilityRole="button"
          className="flex-row items-center gap-1"
        >
          <SfIcon name="square.and.arrow.down" size={12} color={Colors.primaryBlue} />
          <ThemedText variant="caption" style={{ color: Colors.primaryBlue }}>
            {t('meEdit.importFromLinktree')}
          </ThemedText>
        </PressableScale>
      </View>

      {links.map((link, i) => (
        <View key={link.id} style={{ gap: 6, borderWidth: 1, borderColor: Colors.divider, padding: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              value={link.label}
              onChangeText={(v) => { onChangeField(link.id, 'label', v); }}
              placeholder={t('meEdit.linkLabelPlaceholder')}
              placeholderTextColor={Colors.text3}
              className="text-text1"
              style={{ flex: 1, fontSize: 14, paddingVertical: 8 }}
            />
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <PressableScale
                haptic="tap"
                onPress={() => { onMove(link.id, -1); }}
                disabled={i === 0}
                accessibilityRole="button"
                accessibilityLabel={t('meEdit.moveUp')}
                style={{ opacity: i === 0 ? 0.3 : 1, padding: 6 }}
              >
                <SfIcon name="chevron.up" size={14} color={Colors.text2} />
              </PressableScale>
              <PressableScale
                haptic="tap"
                onPress={() => { onMove(link.id, 1); }}
                disabled={i === links.length - 1}
                accessibilityRole="button"
                accessibilityLabel={t('meEdit.moveDown')}
                style={{ opacity: i === links.length - 1 ? 0.3 : 1, padding: 6 }}
              >
                <SfIcon name="chevron.down" size={14} color={Colors.text2} />
              </PressableScale>
              <PressableScale
                haptic="tap"
                onPress={() => { onRemove(link.id); }}
                accessibilityRole="button"
                accessibilityLabel={t('meEdit.removeLink')}
                style={{ padding: 6 }}
              >
                <SfIcon name="trash" size={14} color={Colors.destructive} />
              </PressableScale>
            </View>
          </View>

          <TextInput
            value={link.url}
            onChangeText={(v) => { onChangeField(link.id, 'url', v); }}
            placeholder="https://…"
            placeholderTextColor={Colors.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="text-text1"
            style={{
              fontSize: 14,
              paddingVertical: 8,
              borderTopWidth: 1,
              borderTopColor: Colors.divider,
            }}
          />
          {errors[i] ? (
            <Text className="text-destructive text-[12px]">{errors[i]}</Text>
          ) : null}
        </View>
      ))}

      <ThemedButton
        label={t('meEdit.addLink')}
        variant="secondary"
        leadingIcon={<SfIcon name="plus" size={14} color={Colors.text1} />}
        onPress={onAdd}
      />
    </View>
  );
}
