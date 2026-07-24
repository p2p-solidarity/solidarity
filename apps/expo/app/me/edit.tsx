/**
 * Me › Edit — the Profile Record (01-spec §3) editor (1.3.3 Task A2.2).
 * Edits `displayName` / `bio` / `links` plus the page photo. Library photos
 * stay device-only; a selected Bluesky photo is signed and published.
 *
 * Save flow: AddLinkSheet admits only secure, normalized URLs; the actual
 * submit goes through `useProfileStore().saveProfile()`, which re-validates
 * via `parseProfile` BEFORE ever calling the Face-ID-gated signer (see
 * `src/profile/store.ts`'s module doc) and returns a tagged Result this screen
 * surfaces via `showError` — never a native `Alert.alert`.
 *
 * No provisioned root key → an honest "需要先完成身份設定" state with a CTA
 * into the existing onboarding replay flow (`/onboarding?replay=1`, the
 * same route `settings/index.tsx`'s "Replay Onboarding" row uses — its
 * non-skippable `BackupStep` is what actually provisions the root key).
 * An explicit Save may derive the separate Nostr key when auto-publish is on;
 * mount and first paint never provision it.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarEditor } from '@/components/me/AvatarEditor';
import { AddLinkSheet, type LinkSheetValue } from '@/components/me/AddLinkSheet';
import { EditableLinksList } from '@/components/me/EditableLinksList';
import {
  focusedEditorMode,
  shouldReturnAfterFocusedCancel,
} from '@/components/me/focusedEditorReturn';
import { useAvatarEditor, type ProfileCommitResult } from '@/components/me/useAvatarEditor';
import {
  LinkPageImportSheet,
  type LinkPageImportResult,
} from '@/components/profile/LinkPageImportSheet';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedText, ThemedTextInput } from '@/components/themed';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import {
  isBiometricCancellation,
  isNostrPublishOutcomePartiallyAccepted,
  isNostrPublishOutcomeSuccessful,
  prepareNostrClaimForSave,
  publishWithNostrAutoSetup,
} from '@/nostr/connectWizard';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import {
  getNostrPubkey,
  hasNostrKey,
  npubEncode,
  provisionFromRootMnemonic,
} from '@/nostr/userKey';
import { detectLinkFromUrl, linkPresetForEditableUrl, normalizeLinkUrl } from '@/profile/linkUrl';
import { PublishPreviewSheet } from '@/components/me/PublishPreviewSheet';
import {
  summarizeVisibility,
  type LinkVisibility,
  type VisibilitySummary,
} from '@/profile/projection';
import { useProfileStore, type NostrPublishOutcome } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';
import { uuid, type ProfileLink } from '@solidarity/shared';

interface EditableLink extends LinkSheetValue {
  readonly id: string;
}

type LinkSheetTarget =
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly id: string }
  | null;

type TFn = ReturnType<typeof useTranslation>['t'];

interface CommitProfileOptions {
  /** Only the explicit bottom Save action may create a missing Nostr key. */
  readonly allowNostrProvisioning: boolean;
  readonly publishAfterSave: boolean;
}

function publishFailureDetail(outcome: NostrPublishOutcome, t: TFn): string {
  return t('nostrConnect.publishReportDetail', {
    profileAccepted: outcome.profile.acceptedCount,
    profileTotal: outcome.profile.results.length,
    bindingAccepted: outcome.kind0.acceptedCount,
    bindingTotal: outcome.kind0.results.length,
  });
}

function toEditableLink(link: ProfileLink, visibility: LinkVisibility): EditableLink {
  const detectedPreset = detectLinkFromUrl(link.url)?.preset ?? null;
  return {
    id: uuid(),
    label: link.label,
    url: link.url,
    preset: linkPresetForEditableUrl(detectedPreset, link.url),
    visibility,
  };
}

export default function MeEditScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { add, avatar } = useLocalSearchParams<{
    readonly add?: string;
    readonly avatar?: string;
  }>();
  const record = useProfileStore((s) => s.record);
  const storeLinkVisibility = useProfileStore((s) => s.linkVisibility);
  const saveProfile = useProfileStore((s) => s.saveProfile);
  const publishToNostr = useProfileStore((s) => s.publishToNostr);
  const autoRepublish = usePreferences((s) => s.nostrAutoRepublish);
  // The preference is the user's explicit publishing opt-in. On a first
  // publish, Save provisions the Nostr key and adds its claim before signing;
  // subsequent saves follow the same silent republish path.
  const willAutoRepublish = autoRepublish;

  // Optimistic default — see `ProfileSummaryCard`'s doc for why (the common
  // case already has a provisioned root key; this flips to the honest
  // "needs setup" state only if a real check says otherwise).
  const [rootKeyPresent, setRootKeyPresent] = useState(true);
  const [nostrKeyPresent, setNostrKeyPresent] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void hasRootKey().then((has) => {
      if (!cancelled) setRootKeyPresent(has);
    });
    void hasNostrKey().then((has) => {
      if (!cancelled) setNostrKeyPresent(has);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [displayName, setDisplayName] = useState(record?.displayName ?? '');
  const [bio, setBio] = useState(record?.bio ?? '');
  const [links, setLinks] = useState<readonly EditableLink[]>(() =>
    (record?.links ?? []).map((link, i) => toEditableLink(link, storeLinkVisibility[i] ?? 'public'))
  );
  const [saving, setSaving] = useState(false);
  const [linktreeSheetOpen, setLinktreeSheetOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [focusedMode, setFocusedMode] = useState(() => focusedEditorMode({ add, avatar }));
  const [hasDraftEdits, setHasDraftEdits] = useState(false);
  const [linkSheetTarget, setLinkSheetTarget] = useState<LinkSheetTarget>(() =>
    focusedMode === 'add' ? { kind: 'add' } : null
  );
  const editingLink =
    linkSheetTarget?.kind === 'edit'
      ? (links.find((link) => link.id === linkSheetTarget.id) ?? null)
      : null;

  const submitLinkSheet = (value: LinkSheetValue) => {
    if (linkSheetTarget?.kind === 'edit') {
      setLinks((prev) =>
        prev.map((link) => (link.id === linkSheetTarget.id ? { id: link.id, ...value } : link))
      );
    } else {
      setLinks((prev) => [...prev, { id: uuid(), ...value }]);
    }
    setHasDraftEdits(true);
    setFocusedMode(null);
    setLinkSheetTarget(null);
  };
  const removeLink = (id: string) => {
    setHasDraftEdits(true);
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };
  const moveLink = (id: string, direction: -1 | 1) => {
    setHasDraftEdits(true);
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

  /** Merges CHECKED imported links into the editable rows, deduped against
   * what's already here by url — never a silent overwrite, never a second
   * copy of a link the user already has. The user still has to press the
   * normal Save (Face ID) below; this only edits local draft state. */
  const mergeImportedLinks = (result: LinkPageImportResult) => {
    const existingUrls = new Set(links.map((l) => l.url));
    const additions = result.links
      .filter((l) => !existingUrls.has(l.url))
      .map((l): EditableLink => {
        const detectedPreset = detectLinkFromUrl(l.url)?.preset ?? null;
        return {
          id: uuid(),
          label: l.label,
          url: l.url,
          preset: linkPresetForEditableUrl(detectedPreset, l.url),
          visibility: 'public',
        };
      });
    if (additions.length === 0) return;
    setHasDraftEdits(true);
    setLinks((prev) => [...prev, ...additions]);
    haptic('success');
    pushToast(t('meEdit.linktreeImportMerged', { count: additions.length }), 'success');
  };

  /** Links plus their per-link visibility, kept parallel by index — the
   * shape `saveProfile` persists while building the three signed projections. */
  const submitted = (): { links: ProfileLink[]; linkVisibility: LinkVisibility[] } => {
    return {
      links: links.map((link) => ({
        label: link.label.trim(),
        url: normalizeLinkUrl(link.url),
      })),
      linkVisibility: links.map((link) => link.visibility),
    };
  };

  const commitProfile = async (
    avatarOverride: string | null | undefined,
    options: CommitProfileOptions
  ): Promise<ProfileCommitResult> => {
    const { links: submittedLinks, linkVisibility } = submitted();
    let alsoKnownAs: readonly string[] | undefined;
    if (options.publishAfterSave && options.allowNostrProvisioning) {
      const preparedClaim = await prepareNostrClaimForSave(record?.alsoKnownAs ?? [], {
        hasKey: hasNostrKey,
        provision: provisionFromRootMnemonic,
        getPubkey: getNostrPubkey,
        encodeNpub: npubEncode,
      });
      if (!preparedClaim.ok) {
        if (isBiometricCancellation(preparedClaim.error)) return 'cancelled';
        haptic('error');
        showError({
          context: 'Me › Edit › Publish setup',
          summary: t('meEdit.publishSetupFailed'),
          error: new Error(preparedClaim.error),
        });
        return 'publishFailed';
      }
      alsoKnownAs = preparedClaim.value;
      setNostrKeyPresent(true);
    }

    const saved = await saveProfile(
      {
        displayName: displayName.trim(),
        bio: bio.trim(),
        links: submittedLinks,
        linkVisibility,
      },
      {
        ...(alsoKnownAs === undefined ? {} : { alsoKnownAs }),
        ...(avatarOverride === undefined ? {} : { avatar: avatarOverride }),
      }
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

    if (options.publishAfterSave) {
      const published = options.allowNostrProvisioning
        ? await publishWithNostrAutoSetup({
            hasKey: hasNostrKey,
            provision: provisionFromRootMnemonic,
            publish: async () => await publishToNostr(DEFAULT_RELAYS),
          })
        : await publishToNostr(DEFAULT_RELAYS);
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
      if (
        !isNostrPublishOutcomeSuccessful(published.value) &&
        isNostrPublishOutcomePartiallyAccepted(published.value)
      ) {
        return 'partialSuccess';
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
    }

    return 'success';
  };

  const avatarWillPublish = willAutoRepublish && nostrKeyPresent;
  const avatarEditor = useAvatarEditor({
    record,
    commitProfile: async (avatar) =>
      await commitProfile(avatar, {
        allowNostrProvisioning: false,
        publishAfterSave: avatarWillPublish,
      }),
    willPublish: avatarWillPublish,
    initiallyOpen: focusedMode === 'avatar',
    returnToMeOnFinish: shouldReturnAfterFocusedCancel(
      focusedMode === 'avatar' ? focusedMode : null,
      hasDraftEdits
    ),
  });

  /** Live count of how each link projects (public / link-only / private) —
   *  the honest source for the pre-publish preview. */
  const visibilitySummary = useMemo<VisibilitySummary>(() => {
    const { links: keptLinks, linkVisibility } = submitted();
    return summarizeVisibility(keptLinks, linkVisibility);
  }, [links]);

  const publicLinkLabels = useMemo(
    () => links.filter((link) => link.visibility === 'public').map((link) => link.label.trim()),
    [links]
  );

  const runSave = async () => {
    setSaving(true);
    try {
      const result = await commitProfile(undefined, {
        allowNostrProvisioning: true,
        publishAfterSave: willAutoRepublish,
      });
      if (result !== 'success' && result !== 'partialSuccess') return;

      haptic('success');
      pushToast(
        t(
          result === 'partialSuccess'
            ? 'meEdit.partiallyPublished'
            : willAutoRepublish
              ? 'meEdit.published'
              : 'meEdit.saved'
        ),
        'success'
      );
      safeBack();
    } finally {
      setSaving(false);
    }
  };

  /** Save tap: preview only a real disclosure split. All-public saves publish
   * silently after the one biometric gate; link-only/private links still need
   * the existing explicit review before signing. */
  const handleSave = () => {
    const hasHidden = visibilitySummary.linkOnly > 0 || visibilitySummary.private > 0;
    if (hasHidden) {
      haptic('tap');
      setPreviewOpen(true);
      return;
    }
    void runSave();
  };

  const confirmFromPreview = () => {
    setPreviewOpen(false);
    void runSave();
  };

  if (!rootKeyPresent) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <SettingsBackToolbar
          title={t('meEdit.cancel')}
          onPress={() => {
            safeBack();
          }}
        />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            paddingHorizontal: 32,
          }}>
          <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
            {t('profileCard.needsIdentitySetup')}
          </ThemedText>
          <ThemedButton
            label={t('profileCard.setUpIdentity')}
            variant="primary"
            onPress={() => {
              router.push('/onboarding?replay=1');
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar
        title={t('meEdit.cancel')}
        onPress={() => {
          safeBack();
        }}
      />
      <SettingsScreenTitle title={t('meEdit.title')} />

      <KeyboardAwareScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 48,
          gap: 24,
        }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}>
        <AvatarEditor
          recordAvatar={record?.avatar ?? null}
          displayName={displayName}
          controller={avatarEditor}
        />
        <ThemedTextInput
          label={t('meEdit.displayName')}
          value={displayName}
          onChangeText={(value) => {
            setHasDraftEdits(true);
            setDisplayName(value);
          }}
          placeholder={t('meEdit.displayNamePlaceholder')}
        />
        <ThemedTextInput
          label={t('meEdit.bio')}
          value={bio}
          onChangeText={(value) => {
            setHasDraftEdits(true);
            setBio(value);
          }}
          placeholder={t('meEdit.bioPlaceholder')}
          multiline
        />

        <EditableLinksList
          links={links}
          onAdd={() => {
            setLinkSheetTarget({ kind: 'add' });
          }}
          onEdit={(id) => {
            setLinkSheetTarget({ kind: 'edit', id });
          }}
          onRemove={removeLink}
          onMove={moveLink}
          onImportLinktree={() => {
            setLinktreeSheetOpen(true);
          }}
        />

        <ThemedButton
          label={
            saving
              ? t(willAutoRepublish ? 'meEdit.savingAndPublishing' : 'meEdit.saving')
              : t(willAutoRepublish ? 'meEdit.saveAndPublish' : 'meEdit.save')
          }
          variant="primary"
          fullWidth
          loading={saving}
          onPress={() => {
            handleSave();
          }}
        />
        <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {t(willAutoRepublish ? 'meEdit.publishHint' : 'meEdit.localSaveHint')}
        </ThemedText>
      </KeyboardAwareScrollView>

      <AddLinkSheet
        visible={linkSheetTarget !== null}
        initialLink={editingLink}
        onSubmit={submitLinkSheet}
        onClose={() => {
          const shouldReturn = shouldReturnAfterFocusedCancel(focusedMode, hasDraftEdits);
          setLinkSheetTarget(null);
          setFocusedMode(null);
          if (focusedMode === 'add' && shouldReturn) safeBack();
        }}
      />

      <LinkPageImportSheet
        visible={linktreeSheetOpen}
        title={t('meEdit.importFromLinktree')}
        confirmLabel={t('meEdit.linktreeImportConfirm')}
        onClose={() => {
          setLinktreeSheetOpen(false);
        }}
        onImport={mergeImportedLinks}
      />

      <PublishPreviewSheet
        visible={previewOpen}
        summary={visibilitySummary}
        publicLabels={publicLinkLabels}
        willPublish={willAutoRepublish}
        onConfirm={confirmFromPreview}
        onClose={() => {
          setPreviewOpen(false);
        }}
      />
    </View>
  );
}
