/**
 * Group Management settings — 1:1 port of
 * solidarity/Views/SettingsViews/GroupManagementView.swift
 * (+ GroupManagementView+Components.swift, + YourGroupsSectionView.swift).
 *
 * Layout matches the Swift screen exactly:
 *   • SettingsBackToolbar + screen title "Group Management"
 *   • Header card (person.3.sequence.fill + title, optional sync sub-row)
 *   • iCloud Sign-In Required banner (TODO(android) stub kept hidden)
 *   • Actions section: Create Group, Invite via Link
 *   • Your Groups (delegated to YourGroupsSection)
 *   • Legal & Privacy: Privacy Policy, Terms of Service
 *
 * TODO(android): CloudKitGroupSyncManager isn't ported. The iCloud sign-in
 * banner + invite/privacy/terms rows are toast stubs until the
 * backup-provider identity layer lands.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupJoinSheet } from '@/components/groups/GroupJoinSheet';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { YourGroupsSection } from '@/components/settings/YourGroupsSection';
import { Colors } from '@/constants/Colors';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import {
  useGroupStore,
  type GroupModel,
} from '@/groups/store';
import { useTranslation } from '@/i18n';

export default function GroupManagementSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Seed the manifest synchronously so the section headers + counts render
  // on frame 1; hydrate() resolves the full GroupModel in the background so
  // `YourGroupsSection`'s ownership-filtered sub-lists fill in.
  const seedFromManifest = useGroupStore((s) => s.seedFromManifest);
  const hydrate = useGroupStore((s) => s.hydrate);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);
  const [refreshing, setRefreshing] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const { invite } = useLocalSearchParams<{ invite?: string }>();

  useEffect(() => {
    seedFromManifest();
    void hydrate();
  }, [seedFromManifest, hydrate]);

  // Deep-link parity with Swift DeepLinkManager — when `invite` arrives via
  // `solidarity://group/<token>`, surface the join sheet so the user can
  // confirm the token.
  useEffect(() => {
    if (invite && invite.length > 0) {
      setJoinVisible(true);
    }
  }, [invite]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // TODO(android): plug CloudKit fetchLatestChanges / Drive sync here.
    await hydrate();
    setRefreshing(false);
  }, [hydrate]);

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
      await deleteGroup(group.id);
    })();
  };

  const goCreate = () => { router.push('/groups/new'); };
  const goInvite = () => { setJoinVisible(true); };
  const goPrivacy = () => { pushToast(t('settingsGroups.privacyToast'), 'info'); };
  const goTerms = () => { pushToast(t('settingsGroups.termsToast'), 'info'); };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('settingsGroups.title')} />

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />
        }
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
            <SettingsBlockRow
              icon="link"
              title={t('settingsGroups.inviteViaLink')}
              subtitle={t('settingsGroups.inviteViaLinkSubtitle')}
              onPress={goInvite}
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

      <GroupJoinSheet
        visible={joinVisible}
        onClose={() => { setJoinVisible(false); }}
      />
    </View>
  );
}
