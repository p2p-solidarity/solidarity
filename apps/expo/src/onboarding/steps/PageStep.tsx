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
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import { useProfileStore } from '@/profile/store';
import { profileLinkSchema } from '@solidarity/shared';
import { OnboardingScaffold } from './OnboardingScaffold';

const linkUrlSchema = profileLinkSchema.shape.url;

/** `null` = no error. An empty (never-touched) URL is not an error — the
 * link is simply omitted from the saved payload. */
function validateLinkUrl(url: string): string | null {
  if (url.trim().length === 0) return null;
  const result = linkUrlSchema.safeParse(url);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'invalid URL';
}

export interface PageStepProps {
  readonly onBack: () => void;
  readonly onNext: () => void;
}

export function PageStep({ onBack, onNext }: PageStepProps) {
  const { t } = useTranslation();
  const record = useProfileStore((s) => s.record);
  const saveProfile = useProfileStore((s) => s.saveProfile);

  const [displayName, setDisplayName] = useState(record?.displayName ?? '');
  const [bio, setBio] = useState(record?.bio ?? '');
  const [linkLabel, setLinkLabel] = useState(record?.links[0]?.label ?? '');
  const [linkUrl, setLinkUrl] = useState(record?.links[0]?.url ?? '');
  const [saving, setSaving] = useState(false);

  const linkError = useMemo(() => validateLinkUrl(linkUrl), [linkUrl]);
  const canCreate = displayName.trim().length > 0 && linkError === null;

  const handleCreate = async () => {
    if (!canCreate) {
      haptic('error');
      return;
    }
    setSaving(true);
    try {
      const trimmedUrl = linkUrl.trim();
      const links = trimmedUrl.length > 0 ? [{ label: linkLabel.trim(), url: trimmedUrl }] : [];
      const result = await saveProfile({ displayName: displayName.trim(), bio: bio.trim(), links });
      if (!result.ok) {
        haptic('error');
        showError({
          context: 'Onboarding › Page',
          summary: t('pageStep.saveFailed'),
          error: new Error(result.error),
        });
        return;
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
            label={t('pageStep.create')}
            variant="inverted"
            fullWidth
            loading={saving}
            disabled={!canCreate}
            onPress={() => {
              void handleCreate();
            }}
          />
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
          <TextInput
            value={linkLabel}
            onChangeText={setLinkLabel}
            placeholder={t('pageStep.linkLabelPlaceholder')}
            placeholderTextColor={Colors.text3}
            className="bg-searchBg text-text1"
            style={{
              paddingHorizontal: 14,
              paddingVertical: 14,
              fontSize: 15,
              borderWidth: 1,
              borderColor: Colors.divider,
            }}
          />
          <TextInput
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="https://…"
            placeholderTextColor={Colors.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="bg-searchBg text-text1"
            style={{
              paddingHorizontal: 14,
              paddingVertical: 14,
              fontSize: 15,
              borderWidth: 1,
              borderColor: linkError ? Colors.destructive : Colors.divider,
            }}
          />
          {linkError ? (
            <ThemedText variant="caption" tone="error">
              {linkError}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </OnboardingScaffold>
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
