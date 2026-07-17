/**
 * Me › Edit — the Profile Record (01-spec §3) editor (1.3.3 Task A2.2).
 * Edits `displayName` / `bio` / `links` plus the page photo. Library photos
 * stay device-only; a selected Bluesky photo is signed and published.
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
import { ScrollView, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { AvatarEditor } from '@/components/me/AvatarEditor';
import {
  useAvatarEditor,
  type ProfileCommitResult,
} from '@/components/me/useAvatarEditor';
import { LinkPageImportSheet, type LinkPageImportResult } from '@/components/profile/LinkPageImportSheet';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import {
  isBiometricCancellation,
  isNostrPublishOutcomeSuccessful,
  publishWithNostrAutoSetup,
} from '@/nostr/connectWizard';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { hasNostrKey, provisionFromRootMnemonic } from '@/nostr/userKey';
import {
  composeLinkUrl,
  displayLinkText,
  expandLinkPresetHandle,
  linkInputModelFor,
  urlMatchesPreset,
  isHttpsLinkUrl,
  LINK_LABEL_PRESETS,
  normalizeLinkUrl,
  type LinkLabelPreset,
} from '@/profile/linkUrl';
import { useProfileStore, type NostrPublishOutcome } from '@/profile/store';
import { uuid, type ProfileLink } from '@solidarity/shared';

interface EditableLink {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly preset: LinkLabelPreset | null;
}

type TFn = ReturnType<typeof useTranslation>['t'];

function publishFailureDetail(outcome: NostrPublishOutcome, t: TFn): string {
  return t('nostrConnect.publishReportDetail', {
    profileAccepted: outcome.profile.acceptedCount,
    profileTotal: outcome.profile.results.length,
    bindingAccepted: outcome.kind0.acceptedCount,
    bindingTotal: outcome.kind0.results.length,
  });
}

function toEditableLink(link: ProfileLink): EditableLink {
  return { id: uuid(), label: link.label, url: link.url, preset: presetForLabel(link.label) };
}

/** `null` = no error. An empty (never-touched) URL is not an error — the
 * whole row is simply dropped from the saved payload (see `handleSave`'s
 * `submittedLinks` filter below). */
function validateLinkUrl(url: string, preset: LinkLabelPreset | null, error: string): string | null {
  const prepared = prepareLinkUrl(url, preset);
  if (prepared.length === 0) return null;
  return isHttpsLinkUrl(prepared) ? null : error;
}

function isBlankLink(link: EditableLink): boolean {
  return link.label.trim().length === 0 && link.url.trim().length === 0;
}

function prepareLinkUrl(url: string, preset: LinkLabelPreset | null): string {
  return normalizeLinkUrl(expandLinkPresetHandle(preset, url));
}

function presetForLabel(label: string): LinkLabelPreset | null {
  const normalized = label.trim().toLowerCase();
  return LINK_LABEL_PRESETS.find((preset) => preset === normalized) ?? null;
}

export default function MeEditScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const saveProfile = useProfileStore((s) => s.saveProfile);
  const publishToNostr = useProfileStore((s) => s.publishToNostr);

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

  const linkErrors = useMemo(
    () =>
      links.map((link) =>
        isBlankLink(link)
          ? null
          : validateLinkUrl(link.url, link.preset, t('profileLink.httpsOnly'))
      ),
    [links, t]
  );
  const hasLinkErrors = linkErrors.some((e) => e !== null);

  const addLink = () => {
    setLinks((prev) => [...prev, { id: uuid(), label: '', url: '', preset: null }]);
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
    setLinks((prev) =>
      prev.map((link) =>
        link.id === id
          ? { ...link, [field]: value, ...(field === 'label' ? { preset: null } : {}) }
          : link
      )
    );
  };
  /** Live in-field composition: the field shows only the tail after the
   * inline prefix; the row always stores the full https URL. A pasted full
   * URL replaces the prefix mode outright — if it's not the active
   * platform's, the preset falls back to the generic https prefix. */
  const changeLinkUrl = (id: string, value: string) => {
    setLinks((prev) =>
      prev.map((link) => {
        if (link.id !== id) return link;
        const composed = composeLinkUrl(link.preset, value);
        return urlMatchesPreset(link.preset, composed)
          ? { ...link, url: composed }
          : { ...link, url: composed, preset: null };
      })
    );
  };
  const selectLinkPreset = (id: string, preset: LinkLabelPreset, label: string) => {
    setLinks((prev) =>
      prev.map((link) => {
        if (link.id !== id) return link;
        const tail = displayLinkText(link.preset, link.url);
        // A slash-free tail is a handle/host the user typed before picking
        // the platform — recompose it under the new prefix. A real URL tail
        // stays put; the chip only latches when the URL already matches.
        if (tail.length === 0 || !tail.includes('/')) {
          return { ...link, label, preset, url: composeLinkUrl(preset, tail) };
        }
        return urlMatchesPreset(preset, link.url)
          ? { ...link, label, preset }
          : { ...link, label, preset: null };
      })
    );
  };

  /** Merges CHECKED imported links into the editable rows, deduped against
   * what's already here by url — never a silent overwrite, never a second
   * copy of a link the user already has. The user still has to press the
   * normal Save (Face ID) below; this only edits local draft state. */
  const mergeImportedLinks = (result: LinkPageImportResult) => {
    const existingUrls = new Set(links.map((l) => l.url));
    const additions = result.links
      .filter((l) => !existingUrls.has(l.url))
      .map((l) => ({
        id: uuid(),
        label: l.label,
        url: l.url,
        preset: presetForLabel(l.label),
      }));
    if (additions.length === 0) return;
    setLinks((prev) => [...prev, ...additions]);
    haptic('success');
    pushToast(t('meEdit.linktreeImportMerged', { count: additions.length }), 'success');
  };

  const submittedLinks = (): ProfileLink[] =>
    links
      .filter((link) => !isBlankLink(link))
      .map((link) => ({
        label: link.label.trim(),
        url: prepareLinkUrl(link.url, link.preset),
      }));

  const saveAndPublish = async (
    avatarOverride?: string | null
  ): Promise<ProfileCommitResult> => {
    if (hasLinkErrors) {
      haptic('error');
      return 'invalidLinks';
    }
    const saved = await saveProfile(
      {
        displayName: displayName.trim(),
        bio: bio.trim(),
        links: submittedLinks(),
      },
      avatarOverride === undefined ? undefined : { avatar: avatarOverride }
    );

    if (!saved.ok) {
      if (isBiometricCancellation(saved.error)) return 'cancelled';
      haptic('error');
      showError({
        context: 'Me › Edit',
        summary: t('meEdit.saveFailed'),
        error: new Error(saved.error),
      });
      return 'saveFailed';
    }

    const published = await publishWithNostrAutoSetup({
      hasKey: hasNostrKey,
      provision: provisionFromRootMnemonic,
      publish: async () => await publishToNostr(DEFAULT_RELAYS),
    });
    if (!published.ok) {
      if (isBiometricCancellation(published.error)) return 'cancelled';
      haptic('error');
      showError({
        context: 'Me › Edit › Publish',
        summary: t('meEdit.publishFailed'),
        error: new Error(published.error),
      });
      return 'publishFailed';
    }
    if (!isNostrPublishOutcomeSuccessful(published.value)) {
      haptic('error');
      showError({
        context: 'Me › Edit › Publish',
        summary: t('meEdit.publishFailed'),
        error: new Error(publishFailureDetail(published.value, t)),
      });
      return 'publishFailed';
    }

    return 'success';
  };

  const avatarEditor = useAvatarEditor({
    record,
    commitProfile: saveAndPublish,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveAndPublish();
      if (result !== 'success') return;

      haptic('success');
      pushToast(t('meEdit.published'), 'success');
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

      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 48, gap: 24 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <AvatarEditor
          recordAvatar={record?.avatar ?? null}
          displayName={displayName}
          controller={avatarEditor}
        />
        <ThemedTextInput
          label={t('meEdit.displayName')}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('meEdit.displayNamePlaceholder')}
        />
        <ThemedTextInput
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
          onChangeUrl={changeLinkUrl}
          onSelectPreset={selectLinkPreset}
          onImportLinktree={() => { setLinktreeSheetOpen(true); }}
        />

        <ThemedButton
          label={saving ? t('meEdit.savingAndPublishing') : t('meEdit.saveAndPublish')}
          variant="primary"
          fullWidth
          loading={saving}
          disabled={hasLinkErrors}
          onPress={() => { void handleSave(); }}
        />
        <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {t('meEdit.publishHint')}
        </ThemedText>
      </KeyboardAwareScrollView>

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

function LinksEditor({
  links,
  errors,
  onAdd,
  onRemove,
  onMove,
  onChangeField,
  onChangeUrl,
  onSelectPreset,
  onImportLinktree,
}: {
  readonly links: readonly EditableLink[];
  readonly errors: readonly (string | null)[];
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onChangeField: (id: string, field: 'label' | 'url', value: string) => void;
  readonly onChangeUrl: (id: string, value: string) => void;
  readonly onSelectPreset: (id: string, preset: LinkLabelPreset, label: string) => void;
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
        <View key={link.id} style={{ gap: 8 }}>
          <LinkPresetChips
            selected={link.preset}
            onSelect={(preset, label) => {
              onSelectPreset(link.id, preset, label);
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <ThemedTextInput
                value={link.label}
                onChangeText={(v) => { onChangeField(link.id, 'label', v); }}
                placeholder={t('meEdit.linkLabelPlaceholder')}
                accessibilityLabel={t('meEdit.linkLabelPlaceholder')}
              />
            </View>
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

          <ThemedTextInput
            kind="url"
            value={displayLinkText(link.preset, link.url)}
            onChangeText={(v) => { onChangeUrl(link.id, v); }}
            // The fixed part of the address lives in the field as a
            // read-only prefix (`https://`, `t.me/`, `instagram.com/` …) so
            // the user types only the tail; a pasted full URL replaces the
            // prefix mode entirely (composeLinkUrl).
            inlinePrefix={linkInputModelFor(link.preset).prefix}
            placeholder={
              linkInputModelFor(link.preset).handle
                ? t('profileLink.handlePlaceholder')
                : t('profileLink.urlPlaceholder')
            }
            accessibilityLabel="URL"
            error={errors[i]}
            showClear
          />
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

function LinkPresetChips({
  selected,
  onSelect,
}: {
  readonly selected: LinkLabelPreset | null;
  readonly onSelect: (preset: LinkLabelPreset, label: string) => void;
}): React.ReactNode {
  const { t } = useTranslation();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {LINK_LABEL_PRESETS.map((preset) => {
        const label = t(`profileLink.preset.${preset}`);
        const active = selected === preset;
        return (
          <PressableScale
            key={preset}
            haptic="tap"
            onPress={() => {
              onSelect(preset, label);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}>
            <ThemedSurface
              variant="outlined"
              className="justify-center rounded-none px-3"
              style={{
                minHeight: 44,
                borderColor: active ? Colors.primaryBlue : Colors.divider,
                backgroundColor: active ? Colors.featuredCardBg : Colors.cardBg,
              }}>
              <ThemedText
                variant="label"
                style={active ? { color: Colors.primaryBlue } : undefined}>
                {label}
              </ThemedText>
            </ThemedSurface>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
