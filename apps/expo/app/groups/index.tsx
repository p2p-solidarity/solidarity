/**
 * Groups hub — 1:1 port of Swift GroupManagementView
 *   (solidarity/Views/SettingsViews/GroupManagementView.swift
 *    + GroupManagementView+Components.swift
 *    + YourGroupsSectionView.swift).
 *
 * Layout matches the Swift screen exactly:
 *   • Top safeAreaInset: chevron.left + "Done" leading row
 *   • Header card: person.3.sequence.fill + "Group Management"
 *   • iCloud Sign-In Required banner (Android: replaced by TODO stub)
 *   • Actions section: Create Group, Invite via Link
 *   • Your Groups: Public Groups / Your Private Groups / Shared With You
 *   • Legal & Privacy: Privacy Policy, Terms of Service
 *
 * TODO(android): CloudKitGroupSyncManager isn't ported. The iCloud
 * sign-in banner, "Invite via Link" action, and Privacy/Terms sheet are
 * stubs that route through pushToast until the backup-provider abstraction
 * (CloudKit on iOS / Drive on Android) is wired.
 */
import type { SFSymbol } from 'expo-symbols';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupManagementCard } from '@/components/groups/GroupManagementCard';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import {
  useGroupStore,
  usePrivateOwnedGroups,
  usePrivateSharedGroups,
  usePublicGroups,
  type GroupModel,
} from '@/groups/store';

function SectionLabel({ title }: { readonly title: string }): React.JSX.Element {
  return (
    <Text
      className="text-text2 text-[12px] font-bold px-5"
      style={{ fontFamily: 'Menlo' }}
    >
      {title}
    </Text>
  );
}

interface ActionRowProps {
  readonly icon: SFSymbol;
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
  readonly isLast?: boolean;
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  isLast = false,
}: ActionRowProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="active:opacity-80"
    >
      <View className="flex-row items-center gap-3 px-3 py-4">
        <View
          style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name={icon} size={14} color={Colors.text1} />
        </View>
        <View className="flex-1">
          <Text className="text-text1 text-[15px]">{title}</Text>
          <Text className="text-text3 text-[12px] mt-0.5">{subtitle}</Text>
        </View>
        <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
      </View>
      {!isLast ? (
        <View
          style={{ height: 0.5, backgroundColor: Colors.divider, marginLeft: 44 }}
        />
      ) : null}
    </Pressable>
  );
}

function SectionBlock({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View className="gap-2">
      <View className="px-4">
        <Text className="text-text1 text-[14px]">{title}</Text>
      </View>
      <View className="mx-4 overflow-hidden rounded-lg bg-mutedSurface">
        {children}
      </View>
    </View>
  );
}

export default function GroupsHub(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const hydrate = useGroupStore((s) => s.hydrate);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);
  const groups = useGroupStore((s) => Array.from(s.groups.values()));
  const publicGroups = usePublicGroups();
  const privateOwnedGroups = usePrivateOwnedGroups();
  const privateSharedGroups = usePrivateSharedGroups();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // TODO(android): plug CloudKit fetchLatestChanges / Drive sync here.
    await hydrate();
    setRefreshing(false);
  }, [hydrate]);

  const onDelete = (group: GroupModel) => {
    Alert.alert(
      'Delete Group?',
      'This will remove the group. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteGroup(group.id);
          },
        },
      ]
    );
  };

  const goCreate = () => {
    router.push('/groups/new');
  };

  const goInvite = () => {
    pushToast('Invite via Link lands next iteration', 'info');
  };

  const goPrivacy = () => {
    pushToast('Privacy Policy lands next iteration', 'info');
  };

  const goTerms = () => {
    pushToast('Terms of Service lands next iteration', 'info');
  };

  const openGroup = (group: GroupModel) => {
    router.push({ pathname: '/groups/[id]', params: { id: group.id } });
  };

  return (
    <View className="flex-1 bg-pageBg">
      {/* Top safe-area inset: chevron.left + Done */}
      <View style={{ paddingTop: insets.top }} className="bg-pageBg">
        <View className="px-4 py-1">
          <Pressable
            onPress={() => { router.back(); }}
            accessibilityRole="button"
            accessibilityLabel="Done"
            hitSlop={8}
            className="flex-row items-center gap-1 self-start px-1 py-2 active:opacity-60"
          >
            <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
            <Text className="text-text1 text-[16px]">Done</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="gap-6">
          {/* Group Management header card */}
          <View className="mx-4 mt-2 rounded-xl bg-mutedSurface px-[14px] py-[14px] flex-row items-center gap-3">
            <View style={{ width: 32, alignItems: 'flex-start' }}>
              <SfIcon name="person.3.sequence.fill" size={18} color={Colors.text1} />
            </View>
            <View className="flex-1">
              <Text className="text-text1 text-[18px] font-semibold">
                Group Management
              </Text>
              {/* TODO(android): real sync status (idle/syncing/error/offline) */}
            </View>
          </View>

          {/* iCloud Sign-In Required banner — TODO(android) stub kept hidden by default. */}

          {/* Actions */}
          <SectionBlock title="Actions">
            <ActionRow
              icon="plus.circle.fill"
              title="Create Group"
              subtitle="Create a new CloudKit group"
              onPress={goCreate}
            />
            <ActionRow
              icon="link"
              title="Invite via Link"
              subtitle="Generate invite link for members"
              onPress={goInvite}
              isLast
            />
          </SectionBlock>

          {/* Your Groups */}
          <View className="gap-4">
            <SectionLabel title="Your Groups" />

            {groups.length === 0 ? (
              <Text className="text-text2 text-[14px] px-5">
                No groups found. Create one to get started.
              </Text>
            ) : (
              <View className="gap-3">
                {publicGroups.length > 0 ? (
                  <View className="gap-3">
                    <SectionLabel title="Public Groups" />
                    <View className="px-5 gap-4">
                      {publicGroups.map((g) => (
                        <GroupManagementCard
                          key={g.id}
                          group={g}
                          onPress={() => { openGroup(g); }}
                          onDelete={() => { onDelete(g); }}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {privateOwnedGroups.length > 0 ? (
                  <View className="gap-3 mt-1">
                    <SectionLabel title="Your Private Groups" />
                    <View className="px-5 gap-4">
                      {privateOwnedGroups.map((g) => (
                        <GroupManagementCard
                          key={g.id}
                          group={g}
                          onPress={() => { openGroup(g); }}
                          onDelete={() => { onDelete(g); }}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {privateSharedGroups.length > 0 ? (
                  <View className="gap-3 mt-1">
                    <SectionLabel title="Shared With You" />
                    <View className="px-5 gap-4">
                      {privateSharedGroups.map((g) => (
                        <GroupManagementCard
                          key={g.id}
                          group={g}
                          onPress={() => { openGroup(g); }}
                          onDelete={() => { onDelete(g); }}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {/* Legal & Privacy */}
          <SectionBlock title="Legal & Privacy">
            <ActionRow
              icon="hand.raised"
              title="Privacy Policy"
              subtitle="View our privacy policy"
              onPress={goPrivacy}
            />
            <ActionRow
              icon="doc.text"
              title="Terms of Service"
              subtitle="View terms of service"
              onPress={goTerms}
              isLast
            />
          </SectionBlock>
        </View>
      </ScrollView>
    </View>
  );
}
