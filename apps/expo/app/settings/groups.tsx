/**
 * Group Management settings — 1:1 port of
 * solidarity/Views/SettingsViews/GroupManagementView.swift
 * (+ GroupManagementView+Components.swift, + YourGroupsSectionView.swift).
 *
 * Layout matches the Swift screen exactly:
 *   • SettingsBackToolbar + screen title "Group Management"
 *   • Header card (person.3.sequence.fill + title)
 *   • Actions section: Create Group
 *   • Your Groups (delegated to YourGroupsSection)
 *   • Legal & Privacy: Privacy Policy, Terms of Service
 *
 * Groups are local-only (MMKV) — CloudKit / Drive group sync (and the
 * invite-link join flow it powered) has been removed; see
 * `docs/ref/01-spec-verified-page.md` §9.
 */
import { Redirect, router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { YourGroupsSection } from '@/components/settings/YourGroupsSection';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import {
  useGroupStore,
  type GroupModel,
} from '@/groups/store';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

export default function GroupManagementSettingsRoute() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings" />;

  return <GroupManagementSettings />;
}

function GroupManagementSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Seed the manifest synchronously so the section headers + counts render
  // on frame 1; hydrate() resolves the full GroupModel in the background so
  // `YourGroupsSection`'s ownership-filtered sub-lists fill in.
  const seedFromManifest = useGroupStore((s) => s.seedFromManifest);
  const hydrate = useGroupStore((s) => s.hydrate);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  useEffect(() => {
    seedFromManifest();
    void hydrate();
  }, [seedFromManifest, hydrate]);

  const onOpen = (group: GroupModel) => {
    router.push({ pathname: '/groups/[id]', params: { id: group.id } });
  };

  const onDelete = (group: GroupModel) => {
    void (async () => {
      const ok = await confirmDialog({
        title: t('settingsGroups.deleteConfirm.title'),
        message: t('settingsGroups.deleteConfirm.message'),
        confirmLabel: t('settingsGroups.deleteConfirm.confirm'),
        destructive: true,
      });
      if (!ok) return;
      try {
        await deleteGroup(group.id);
        pushToast(t('settingsGroups.deleted'), 'success', 2000);
      } catch (error) {
        showError({
          context: 'Groups › Delete Group',
          summary: t('settingsGroups.deleteFailed'),
          error,
        });
      }
    })();
  };

  const goCreate = () => { router.push('/groups/new'); };
  const goPrivacy = () => { router.push('/legal/privacy'); };
  const goTerms = () => { router.push('/legal/terms'); };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('settingsGroups.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 40 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Header card (person.3.sequence.fill + title) */}
          <View
            className="mx-4 rounded-xl bg-mutedSurface flex-row items-center gap-3"
            style={{ paddingHorizontal: 14, paddingVertical: 14 }}
          >
            <View style={{ width: 32, alignItems: 'flex-start' }}>
              <SfIcon
                name="person.3.sequence.fill"
                size={18}
                color={Colors.text1}
              />
            </View>
            <View className="flex-1">
              <Text className="text-text1 text-[18px] font-semibold">
                {t('settingsGroups.title')}
              </Text>
              {/* TODO(android): real sync status (idle/syncing/error/offline) */}
            </View>
          </View>

          {/* Actions */}
          <SettingsBlockSection title={t('settingsGroups.actions')}>
            <SettingsBlockRow
              icon="plus.circle.fill"
              title={t('settingsGroups.createGroup')}
              subtitle={t('settingsGroups.createGroupSubtitle')}
              onPress={goCreate}
            />
          </SettingsBlockSection>

          {/* Your Groups */}
          <YourGroupsSection onOpen={onOpen} onDelete={onDelete} />

          {/* Legal & Privacy */}
          <SettingsBlockSection title={t('settingsGroups.legalPrivacy')}>
            <SettingsBlockRow
              icon="hand.raised"
              title={t('settingsGroups.privacyPolicy')}
              subtitle={t('settingsGroups.privacyPolicySubtitle')}
              onPress={goPrivacy}
            />
            <SettingsBlockRow
              icon="doc.text"
              title={t('settingsGroups.termsOfService')}
              subtitle={t('settingsGroups.termsOfServiceSubtitle')}
              onPress={goTerms}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
