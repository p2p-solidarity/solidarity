import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { ProfileLink } from '@solidarity/shared';

import { PressableScale } from '@/components/common/PressableScale';
import { LinkPageImportSheet } from '@/components/profile/LinkPageImportSheet';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  ThemedButton,
  ThemedSurface,
  ThemedText,
  ThemedTextInput,
} from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import { isHttpsLinkUrl, normalizeLinkUrl } from '@/profile/linkUrl';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';

import { V2OnboardingScaffold } from './V2OnboardingScaffold';

type LinksPhase = 'choose' | 'manual';

function mergeLinks(
  existing: readonly ProfileLink[],
  additions: readonly ProfileLink[],
): readonly ProfileLink[] {
  const seen = new Set(existing.map((link) => link.url));
  return [
    ...existing,
    ...additions.filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    }),
  ];
}

export function LinksStep({
  onBack,
  onDone,
}: {
  readonly onBack: () => void;
  readonly onDone: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const username = usePreferences((state) => state.publicPageUsername);
  const record = useProfileStore((state) => state.record);
  const visibility = useProfileStore((state) => state.linkVisibility);
  const saveProfile = useProfileStore((state) => state.saveProfile);
  const [phase, setPhase] = useState<LinksPhase>('choose');
  const [importOpen, setImportOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const preparedUrl = normalizeLinkUrl(url);
  const urlError = preparedUrl.length === 0 || isHttpsLinkUrl(preparedUrl)
    ? null
    : t('profileLink.httpsOnly');

  const saveLinks = async (additions: readonly ProfileLink[]): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const existing = record?.links ?? [];
      const links = mergeLinks(existing, additions);
      const saved = await saveProfile({
        displayName: record?.displayName.trim() || username,
        bio: record?.bio ?? '',
        links,
        linkVisibility: [
          ...visibility,
          ...Array.from({ length: links.length - existing.length }, () => 'public' as const),
        ],
      });
      if (!saved.ok) throw new Error(saved.error);
      haptic('success');
      onDone();
    } catch (error) {
      haptic('error');
      showError({
        context: 'Onboarding › Links',
        summary: t('ob.links.failed'),
        error,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <V2OnboardingScaffold
        stepIndex={3}
        title={t('ob.links.title')}
        subtitle={t('ob.links.sub')}
        onBack={phase === 'manual' ? () => { setPhase('choose'); } : onBack}
        footer={
          phase === 'manual' ? (
            <ThemedButton
              label={t('ob.links.add')}
              variant="primary"
              fullWidth
              loading={saving}
              disabled={preparedUrl.length === 0 || urlError !== null}
              onPress={() => {
                void saveLinks([{ label: label.trim(), url: preparedUrl }]);
              }}
            />
          ) : undefined
        }>
        {phase === 'choose' ? (
          <View style={{ gap: 12, paddingTop: 20 }}>
            <ChoiceCard
              icon="bolt.fill"
              title={t('ob.links.import')}
              subtitle={t('ob.links.import.sub')}
              onPress={() => { setImportOpen(true); }}
            />
            <ChoiceCard
              icon="square.and.pencil"
              title={t('ob.links.manual')}
              subtitle={t('ob.links.manual.sub')}
              onPress={() => { setPhase('manual'); }}
            />
            <ThemedButton
              label={t('ob.links.empty')}
              variant="secondary"
              fullWidth
              loading={saving}
              onPress={() => { void saveLinks([]); }}
            />
          </View>
        ) : (
          <View style={{ gap: 14, paddingTop: 20 }}>
            <ThemedTextInput
              label={t('ob.links.label')}
              value={label}
              onChangeText={setLabel}
              placeholder={t('ob.links.label.placeholder')}
            />
            <ThemedTextInput
              kind="url"
              label={t('ob.links.url')}
              value={url}
              onChangeText={setUrl}
              placeholder="https://"
              error={urlError}
            />
          </View>
        )}
      </V2OnboardingScaffold>

      <LinkPageImportSheet
        visible={importOpen}
        title={t('ob.links.import')}
        confirmLabel={t('ob.links.import.confirm')}
        onClose={() => { setImportOpen(false); }}
        onImport={(result) => {
          void saveLinks(result.links.map((link) => ({
            label: link.label,
            url: link.url,
          })));
        }}
      />
    </>
  );
}

function ChoiceCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  readonly icon: 'bolt.fill' | 'square.and.pencil';
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      containerStyle={{ alignSelf: 'stretch' }}>
      <ThemedSurface
        variant="card"
        className="flex-row items-center gap-4 rounded-none px-4 py-4"
        style={{ minHeight: 76 }}>
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: Colors.searchBg }}>
          <SfIcon name={icon} size={20} color={Colors.primaryMauve} />
        </View>
        <View className="flex-1 gap-1">
          <ThemedText variant="label">{title}</ThemedText>
          <ThemedText variant="caption" tone="secondary">
            {subtitle}
          </ThemedText>
        </View>
        <SfIcon name="chevron.right" size={15} color={Colors.text3} />
      </ThemedSurface>
    </PressableScale>
  );
}
