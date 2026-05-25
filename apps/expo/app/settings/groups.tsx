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

export default function GroupManagementSettings() {
  const insets = useSafeAreaInsets();
  const hydrate = useGroupStore((s) => s.hydrate);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);
  const [refreshing, setRefreshing] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);
  const { invite } = useLocalSearchParams<{ invite?: string }>();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
        title: 'Delete Group?',
        message: 'This will remove the group. This action cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      await deleteGroup(group.id);
    })();
  };

  const goCreate = () => { router.push('/groups/new'); };
  const goInvite = () => { setJoinVisible(true); };
  const goPrivacy = () => { pushToast('Privacy Policy lands next iteration', 'info'); };
  const goTerms = () => { pushToast('Terms of Service lands next iteration', 'info'); };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Group Management" />

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
                Group Management
              </Text>
              {/* TODO(android): real sync status (idle/syncing/error/offline) */}
            </View>
          </View>

          {/* Actions */}
          <SettingsBlockSection title="Actions">
            <SettingsBlockRow
              icon="plus.circle.fill"
              title="Create Group"
              subtitle="Create a new CloudKit group"
              onPress={goCreate}
            />
            <SettingsBlockRow
              icon="link"
              title="Invite via Link"
              subtitle="Generate invite link for members"
              onPress={goInvite}
            />
          </SettingsBlockSection>

          {/* Your Groups */}
          <YourGroupsSection onOpen={onOpen} onDelete={onDelete} />

          {/* Legal & Privacy */}
          <SettingsBlockSection title="Legal & Privacy">
            <SettingsBlockRow
              icon="hand.raised"
              title="Privacy Policy"
              subtitle="View our privacy policy"
              onPress={goPrivacy}
            />
            <SettingsBlockRow
              icon="doc.text"
              title="Terms of Service"
              subtitle="View terms of service"
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
