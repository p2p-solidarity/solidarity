/**
 * Group detail — 1:1 port of Swift GroupDetailView
 *   (solidarity/Views/IDViews/GroupDetailView.swift
 *    + GroupDetailView+Subviews.swift
 *    + GroupDetailView+MemberViews.swift).
 *
 * Layout matches the Swift screen exactly:
 *   • Inline nav title "{group.name}" with chevron.left back
 *   • LazyVStack with 20-pt spacing:
 *       – optional error banner
 *       – Group Info        (GroupInfoSection)
 *       – Merkle Tree       (MerkleTreeSection)
 *       – Invite            (InviteSection)
 *       – Members           (MembersSection)
 *       – Admin Tools       (CredentialIssuers + GroupVCIssuance + DeliverySettings — TODO)
 *       – Identity Info     (IdentityInfoSection / OIDC)
 *
 * TODO(android): CloudKitGroupSyncManager / SemaphoreGroupManager /
 * SemaphoreIdentityManager / GroupCredentialService are not ported.
 * Member kick/approve/reject only mutate the local zustand store; the
 * Admin Tools block is a labelled stub so the visual contract is preserved.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CredentialIssuersSection } from '@/components/groups/CredentialIssuersSection';
import { DeliverySettingsSection } from '@/components/groups/DeliverySettingsSection';
import {
  GroupInfoSection,
  IdentityInfoSection,
  InviteSection,
  MerkleTreeSection,
} from '@/components/groups/GroupDetailSections';
import { MembersSection } from '@/components/groups/GroupMembersSection';
import { GroupVCIssuanceSection } from '@/components/groups/GroupVCIssuanceSection';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import {
  canIssueCredentials,
  isOwner,
  useGroup,
  useGroupMembers,
  useGroupStore,
  type GroupMember,
  type GroupModel,
} from '@/groups/store';

const MONO_FONT = 'Menlo';

function NavBar({
  title,
}: {
  readonly title: string;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top }} className="bg-pageBg">
      <View className="h-11 flex-row items-center px-4">
        <Pressable
          onPress={() => { router.back(); }}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          className="-ml-1 px-1 py-1 active:opacity-60"
        >
          <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
        </Pressable>
        <View className="flex-1 items-center">
          <Text
            numberOfLines={1}
            className="text-text1 text-[17px] font-semibold"
          >
            {title}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>
    </View>
  );
}

function AdminTools({
  group,
}: {
  readonly group: import('@/groups/store').GroupModel;
}): React.JSX.Element {
  // 1:1 port of Swift IDView "Admin Tools" stack
  // (GroupDetailView.swift: `if isOwner || canIssueCredentials { ... }`).
  return (
    <View className="gap-3">
      <Text
        className="text-text2 text-[12px] font-bold pl-1"
        style={{ fontFamily: MONO_FONT }}
      >
        Admin Tools
      </Text>
      <CredentialIssuersSection group={group} />
      <GroupVCIssuanceSection group={group} />
      <DeliverySettingsSection group={group} />
    </View>
  );
}

export default function GroupDetail(): React.JSX.Element {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const hydrate = useGroupStore((s) => s.hydrate);
  const upsertMember = useGroupStore((s) => s.upsertMember);
  const group = useGroup(id);
  const members = useGroupMembers(id);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoadingMembers(true);
    try {
      // TODO(android): pull members from CloudKitGroupSyncManager.getMembers.
      await hydrate();
      setErrorMessage(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsLoadingMembers(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const onKick = (m: GroupMember) => {
    void upsertMember({ ...m, status: 'kicked' });
    pushToast(`Kicked ${m.userRecordID}`, 'warning');
  };

  const onApprove = (m: GroupMember) => {
    void upsertMember({ ...m, status: 'active' });
    pushToast(`Approved ${m.userRecordID}`, 'success');
  };

  const onReject = (m: GroupMember) => {
    void upsertMember({ ...m, status: 'left' });
    pushToast(`Rejected ${m.userRecordID}`, 'info');
  };

  const displayName = group?.name ?? name ?? 'Group';

  if (!group) {
    return (
      <View className="flex-1 bg-pageBg">
        <NavBar title={displayName} />
        <View className="flex-1 items-center justify-center p-6">
          <ThemedText>Group not found.</ThemedText>
        </View>
      </View>
    );
  }

  const owner = isOwner(group);
  const adminVisible = owner || canIssueCredentials(group);

  return (
    <View className="flex-1 bg-pageBg">
      <NavBar title={displayName} />

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <View className="gap-5">
          {errorMessage ? (
            <View
              className="p-2 rounded-lg"
              style={{ backgroundColor: `${Colors.destructive}1A` }}
            >
              <Text className="text-destructive text-[12px]">
                {errorMessage}
              </Text>
            </View>
          ) : null}

          <GroupInfoSection group={group} memberCount={members.length} />

          <MerkleTreeSection group={group} />

          <InviteSection group={group} />

          <MembersSection
            members={members}
            isLoading={isLoadingMembers}
            isOwner={owner}
            onKick={onKick}
            onApprove={onApprove}
            onReject={onReject}
          />

          {adminVisible ? <AdminTools group={group} /> : null}

          <IdentityInfoSection group={group} />
        </View>
      </ScrollView>
    </View>
  );
}
