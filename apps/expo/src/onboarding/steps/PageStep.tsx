/**
 * PageStep — onboarding "建頁" step (1.3.3 Task A2.5, converges onboarding
 * onto the Verified Page flow, US-01). Runs immediately after the
 * non-skippable `backup` step, by which point a root identity is guaranteed
 * to exist (`secureKeys` + `backup` provision it unconditionally — see
 * `src/identity/rootKey.ts`), so unlike `app/me/edit.tsx` this step never
 * needs a "no root key yet" gate.
 *
 * A deliberately minimal mini-form (displayName + optional bio + optional
 * single link) rather than routing into `/me/edit` and back: onboarding is
 * a single-screen, reducer-driven wizard (`app/onboarding/index.tsx`), and
 * threading a "did the user save in /me/edit?" signal back into that
 * reducer would entangle a general-purpose editor screen with
 * onboarding-only state just to resume the wizard. The full multi-link
 * editor stays reachable afterward from Me for anyone who wants more than
 * one link.
 *
 * Save goes straight through `useProfileStore().saveProfile()` — the same
 * validate → Face-ID-sign → persist path `/me/edit` uses — so the page
 * created here is byte-identical in shape to one created later. Skip is
 * honest (CLAUDE.md rule 8): it never creates an empty/placeholder record,
 * it just advances, and the copy tells the user where to come back
 * (Me).
 *
 * On REPLAY with an already-saved profile, the fields are pre-filled from
 * the current record so re-running onboarding doesn't blank out an existing
 * page — mirrors `BackupStep`'s idempotent-on-replay handling.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
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
import { useProfileStore } from '@/profile/store';
import { shouldAutoRepublish } from '@/profile/publishingPolicy';
import { usePreferences } from '@/settings/preferences';
import { OnboardingScaffold } from './OnboardingScaffold';

/** `null` = no error. An empty (never-touched) URL is not an error — the
 * link is simply omitted from the saved payload. */
function prepareLinkUrl(url: string, preset: LinkLabelPreset | null): string {
  return normalizeLinkUrl(expandLinkPresetHandle(preset, url));
}

export interface PageStepProps {
  readonly onBack: () => void;
  readonly onNext: () => void;
}

export function PageStep({ onBack, onNext }: PageStepProps) {
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const saveProfile = useProfileStore((s) => s.saveProfile);
  const publishToNostr = useProfileStore((s) => s.publishToNostr);
  const autoRepublish = usePreferences((s) => s.nostrAutoRepublish);
  const isAlreadyPublished =
    record?.alsoKnownAs.some((alias) => alias.startsWith('nostr:npub')) === true;
  const willAutoRepublish = shouldAutoRepublish(isAlreadyPublished, autoRepublish);

  const [displayName, setDisplayName] = useState(record?.displayName ?? '');
  const [bio, setBio] = useState(record?.bio ?? '');
  const [linkLabel, setLinkLabel] = useState(record?.links[0]?.label ?? '');
  const [linkUrl, setLinkUrl] = useState(record?.links[0]?.url ?? '');
  const [linkPreset, setLinkPreset] = useState<LinkLabelPreset | null>(null);
  const [saving, setSaving] = useState(false);
  const publishCopy = pageStepPublishCopy(willAutoRepublish, saving);

  const preparedLinkUrl = useMemo(
    () => prepareLinkUrl(linkUrl, linkPreset),
    [linkPreset, linkUrl]
  );
  const linkError =
    preparedLinkUrl.length === 0 || isHttpsLinkUrl(preparedLinkUrl)
      ? null
      : t('profileLink.httpsOnly');
  const canCreate = displayName.trim().length > 0 && linkError === null;

  const handleCreate = async () => {
    if (!canCreate) {
      haptic('error');
      return;
    }
    setSaving(true);
    try {
      const links =
        preparedLinkUrl.length > 0
          ? [{ label: linkLabel.trim(), url: preparedLinkUrl }]
          : [];
      const saved = await saveProfile({ displayName: displayName.trim(), bio: bio.trim(), links });
      if (!saved.ok) {
        if (isBiometricCancellation(saved.error)) return;
        haptic('error');
        showError({
          context: 'Onboarding › Page',
          summary: t('pageStep.saveFailed'),
          error: new Error(saved.error),
        });
        return;
      }

      if (willAutoRepublish) {
        const published = await publishWithNostrAutoSetup({
          hasKey: hasNostrKey,
          provision: provisionFromRootMnemonic,
          publish: async () => await publishToNostr(DEFAULT_RELAYS),
        });
        if (!published.ok || !isNostrPublishOutcomeSuccessful(published.value)) {
          if (!published.ok && isBiometricCancellation(published.error)) return;
          haptic('error');
          showError({
            context: 'Onboarding › Page › Republish',
            summary: t('pageStep.publishFailed'),
            error: new Error(
              published.ok
                ? t('nostrConnect.publishReportDetail', {
                    profileAccepted: published.value.profile.acceptedCount,
                    profileTotal: published.value.profile.results.length,
                    bindingAccepted: published.value.kind0.acceptedCount,
                    bindingTotal: published.value.kind0.results.length,
                  })
                : published.error,
            ),
          });
          return;
        }
      }

      haptic('success');
      onNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingScaffold
      onBack={onBack}
      title={t('pageStep.title')}
      subtitle={t('pageStep.subtitle')}
      footer={
        <View style={{ gap: 12 }}>
          <ThemedButton
            label={t(publishCopy.button)}
            variant="inverted"
            fullWidth
            loading={saving}
            disabled={!canCreate}
            onPress={() => {
              void handleCreate();
            }}
          />
          <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            {t(publishCopy.hint)}
          </ThemedText>
          <ThemedButton
            label={t('pageStep.skip')}
            variant="dottedOutline"
            fullWidth
            disabled={saving}
            onPress={onNext}
          />
          <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            {t('pageStep.skipHint')}
          </ThemedText>
        </View>
      }
    >
      <View style={{ gap: 20 }}>
        <FieldBlock
          label={t('pageStep.displayName')}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('pageStep.displayNamePlaceholder')}
        />
        <FieldBlock
          label={t('pageStep.bio')}
          value={bio}
          onChangeText={setBio}
          placeholder={t('pageStep.bioPlaceholder')}
          multiline
        />
        <View style={{ gap: 8 }}>
          <ThemedText variant="label">{t('pageStep.link')}</ThemedText>
          <LinkPresetChips
            selected={linkPreset}
            onSelect={(preset, label) => {
              setLinkLabel(label);
              // Same rule as Me › Edit: a slash-free tail typed before the
              // chip is the handle — recompose it under the new prefix; a
              // real URL only latches when it already matches the platform.
              const tail = displayLinkText(linkPreset, linkUrl);
              if (tail.length === 0 || !tail.includes('/')) {
                setLinkPreset(preset);
                setLinkUrl(composeLinkUrl(preset, tail));
              } else {
                setLinkPreset(urlMatchesPreset(preset, linkUrl) ? preset : null);
              }
            }}
          />
          <ThemedTextInput
            value={linkLabel}
            onChangeText={(value) => {
              setLinkLabel(value);
              setLinkPreset(null);
            }}
            placeholder={t('pageStep.linkLabelPlaceholder')}
          />
          <ThemedTextInput
            kind="url"
            value={displayLinkText(linkPreset, linkUrl)}
            onChangeText={(v) => {
              const composed = composeLinkUrl(linkPreset, v);
              if (!urlMatchesPreset(linkPreset, composed)) setLinkPreset(null);
              setLinkUrl(composed);
            }}
            inlinePrefix={linkInputModelFor(linkPreset).prefix}
            placeholder={
              linkInputModelFor(linkPreset).handle
                ? t('profileLink.handlePlaceholder')
                : t('profileLink.urlPlaceholder')
            }
            error={linkError}
            showClear
          />
        </View>
      </View>
    </OnboardingScaffold>
  );
}

function pageStepPublishCopy(
  willAutoRepublish: boolean,
  saving: boolean,
): {
  readonly button:
    | 'pageStep.savingAndPublishing'
    | 'pageStep.saving'
    | 'pageStep.saveAndPublish'
    | 'pageStep.create';
  readonly hint: 'pageStep.publishHint' | 'pageStep.localHint';
} {
  const hint = willAutoRepublish ? 'pageStep.publishHint' : 'pageStep.localHint';
  if (saving) {
    return {
      button: willAutoRepublish ? 'pageStep.savingAndPublishing' : 'pageStep.saving',
      hint,
    };
  }
  return {
    button: willAutoRepublish ? 'pageStep.saveAndPublish' : 'pageStep.create',
    hint,
  };
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
      <ThemedTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
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
}): ReactNode {
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
