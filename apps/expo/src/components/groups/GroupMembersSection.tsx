/**
 * GroupMembersSection — 1:1 port of MembersSection + PendingMemberRow +
 * MemberRow from solidarity/Views/IDViews/GroupDetailView+MemberViews.swift.
 *
 * Extracted from GroupDetailSections so each file stays under the 500-line
 * cap in apps/expo/CLAUDE.md.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { SectionHeader } from './GroupDetailSections';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { GroupMember } from '@/groups/store';

const MONO_FONT = 'Menlo';

export interface MembersSectionProps {
  readonly members: readonly GroupMember[];
  readonly isLoading: boolean;
  readonly isOwner: boolean;
  readonly onKick: (m: GroupMember) => void;
  readonly onApprove: (m: GroupMember) => void;
  readonly onReject: (m: GroupMember) => void;
}

export function MembersSection({
  members,
  isLoading,
  isOwner,
  onKick,
  onApprove,
  onReject,
}: MembersSectionProps): ReactNode {
  const pending = members.filter((m) => m.status === 'pending');
  const active = members.filter(
    (m) => m.status === 'active' || m.status === 'kicked'
  );

  return (
    <View className="gap-3">
      <View className="flex-row items-center">
        <SectionHeader title="Members" />
        <View className="flex-1" />
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.text2} />
        ) : null}
      </View>

      {members.length === 0 && !isLoading ? (
        <View
          className="bg-searchBg p-4 items-center"
          style={{ borderWidth: 1, borderColor: Colors.divider }}
        >
          <Text className="text-text2 text-[15px]">No members found.</Text>
        </View>
      ) : (
        <View className="gap-4">
          {pending.length > 0 ? (
            <View className="gap-2">
              <Text
                className="text-accentRose text-[12px] font-bold pl-1"
                style={{ fontFamily: MONO_FONT }}
              >
                Pending Requests
              </Text>
              <View
                className="bg-searchBg"
                style={{ borderWidth: 1, borderColor: Colors.divider }}
              >
                {pending.map((m, i) => (
                  <View key={m.id}>
                    <PendingMemberRow
                      member={m}
                      isOwner={isOwner}
                      onApprove={() => { onApprove(m); }}
                      onReject={() => { onReject(m); }}
                    />
                    {i !== pending.length - 1 ? (
                      <View
                        style={{
                          height: 0.5,
                          backgroundColor: Colors.divider,
                          marginLeft: 16,
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {active.length > 0 ? (
            <View className="gap-2">
              {pending.length > 0 ? (
                <Text
                  className="text-text2 text-[12px] font-bold pl-1"
                  style={{ fontFamily: MONO_FONT }}
                >
                  Active Members
                </Text>
              ) : null}
              <View
                className="bg-searchBg"
                style={{ borderWidth: 1, borderColor: Colors.divider }}
              >
                {active.map((m, i) => (
                  <View key={m.id}>
                    <MemberRow
                      member={m}
                      isOwner={isOwner}
                      onKick={() => { onKick(m); }}
                    />
                    {i !== active.length - 1 ? (
                      <View
                        style={{
                          height: 0.5,
                          backgroundColor: Colors.divider,
                          marginLeft: 16,
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function PendingMemberRow({
  member,
  isOwner,
  onApprove,
  onReject,
}: {
  readonly member: GroupMember;
  readonly isOwner: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}): ReactNode {
  return (
    <View className="flex-row items-center p-4">
      <View className="flex-1">
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          className="text-text1 text-[15px]"
        >
          {member.userRecordID}
        </Text>
        <Text className="text-accentRose text-[12px] mt-0.5">
          Requesting to join
        </Text>
      </View>

      {isOwner ? (
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={onReject}
            accessibilityRole="button"
            accessibilityLabel="Reject"
            hitSlop={8}
          >
            <SfIcon
              name="xmark.circle.fill"
              size={22}
              color={Colors.destructive}
            />
          </Pressable>
          <Pressable
            onPress={onApprove}
            accessibilityRole="button"
            accessibilityLabel="Approve"
            hitSlop={8}
          >
            <SfIcon
              name="checkmark.circle.fill"
              size={22}
              color={Colors.terminalGreen}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function MemberRow({
  member,
  isOwner,
  onKick,
}: {
  readonly member: GroupMember;
  readonly isOwner: boolean;
  readonly onKick: () => void;
}): ReactNode {
  const isOwnerRole = member.role === 'owner';
  const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);

  return (
    <View className="flex-row items-center p-4">
      <View className="flex-1">
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          className="text-text1 text-[15px]"
        >
          {member.userRecordID}
        </Text>
        <View className="flex-row items-center gap-1.5 mt-1">
          <View
            style={{
              backgroundColor: isOwnerRole
                ? `${Colors.primaryBlue}1A`
                : `${Colors.text3}1A`,
              borderRadius: 4,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text
              className="text-[12px]"
              style={{
                color: isOwnerRole ? Colors.primaryBlue : Colors.text2,
              }}
            >
              {roleLabel}
            </Text>
          </View>
          {member.status === 'kicked' ? (
            <Text className="text-destructive text-[12px]">Kicked</Text>
          ) : null}
        </View>
      </View>

      {/* hasMessagingData parity: pubKey/signPubKey present ⇒ can DM. */}
      {member.pubKey && member.signPubKey ? (
        <SfIcon
          name="bubble.left.and.bubble.right.fill"
          size={14}
          color={Colors.accentRose}
        />
      ) : null}

      {isOwner && !isOwnerRole && member.status !== 'kicked' ? (
        <View className="ml-3">
          <ThemedButton
            variant="destructive"
            label="Kick"
            size="sm"
            onPress={onKick}
          />
        </View>
      ) : null}
    </View>
  );
}
