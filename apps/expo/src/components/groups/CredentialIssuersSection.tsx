/**
 * CredentialIssuersSection + IssuerRow — 1:1 port of Swift
 *   (solidarity/Views/IDViews/GroupDetailView/CredentialIssuersSection.swift).
 *
 * Visual:
 *   • mono-bold 12pt "Credential Issuers" header + (owner-only) plus button
 *   • Always-present IssuerRow for the group owner (crown.fill icon)
 *   • One IssuerRow per `credentialIssuers` entry (person.badge.key.fill)
 *   • Empty hint: "No additional issuers configured yet." (owner) or
 *     "Only the group owner can assign additional credential issuers."
 *   • searchBg + 1pt divider stroke wrapper
 *   • Sheet trigger: <AddIssuerSheet>
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AddIssuerSheet } from './AddIssuerSheet';
import { SectionHeader } from './GroupDetailSections';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import {
  isOwner as isOwnerOf,
  useGroupMembers,
  useGroupStore,
  type GroupMember,
  type GroupModel,
} from '@/groups/store';

const MONO_FONT = 'Menlo';

export interface CredentialIssuersSectionProps {
  readonly group: GroupModel;
}

export function CredentialIssuersSection({
  group,
}: CredentialIssuersSectionProps): ReactNode {
  const owner = isOwnerOf(group);
  const members = useGroupMembers(group.id);
  const upsertGroup = useGroupStore((s) => s.upsertGroup);
  const [showAdd, setShowAdd] = useState(false);

  const issuers = members.filter((m) =>
    group.credentialIssuers.includes(m.userRecordID)
  );

  const onRemove = (userId: string): void => {
    if (!owner) return;
    void upsertGroup({
      ...group,
      credentialIssuers: group.credentialIssuers.filter((id) => id !== userId),
    });
    pushToast('Issuer removed', 'success');
  };

  const onAddIssuer = (m: GroupMember): void => {
    void upsertGroup({
      ...group,
      credentialIssuers: [...group.credentialIssuers, m.userRecordID],
    });
    pushToast(`${m.userRecordID} can now issue Group VCs`, 'success');
    setShowAdd(false);
  };

  return (
    <View
      className="bg-searchBg p-4"
      style={{ borderWidth: 1, borderColor: Colors.divider, gap: 12 }}
    >
      <View className="flex-row items-center">
        <SectionHeader title="Credential Issuers" />
        <View className="flex-1" />
        {owner ? (
          <Pressable
            onPress={() => { setShowAdd(true); }}
            accessibilityRole="button"
            accessibilityLabel="Add credential issuer"
            hitSlop={8}
            className="active:opacity-60"
          >
            <SfIcon
              name="plus.circle.fill"
              size={20}
              color={Colors.primaryBlue}
            />
          </Pressable>
        ) : null}
      </View>

      <IssuerRow
        userRecordID={group.ownerRecordID}
        isOwner
        canRemove={false}
      />

      {issuers.map((m) => (
        <IssuerRow
          key={m.userRecordID}
          userRecordID={m.userRecordID}
          isOwner={false}
          canRemove={owner}
          onRemove={() => { onRemove(m.userRecordID); }}
        />
      ))}

      {issuers.length === 0 ? (
        <Text
          style={{ fontFamily: MONO_FONT }}
          className="text-text2 text-[10px]"
        >
          {owner
            ? 'No additional issuers configured yet.'
            : 'Only the group owner can assign additional credential issuers.'}
        </Text>
      ) : null}

      <AddIssuerSheet
        visible={showAdd}
        group={group}
        members={members}
        onSelect={onAddIssuer}
        onClose={() => { setShowAdd(false); }}
      />
    </View>
  );
}

interface IssuerRowProps {
  readonly userRecordID: string;
  readonly isOwner: boolean;
  readonly canRemove: boolean;
  readonly onRemove?: () => void;
}

function IssuerRow({
  userRecordID,
  isOwner,
  canRemove,
  onRemove,
}: IssuerRowProps): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
      }}
    >
      <SfIcon
        name={isOwner ? 'crown.fill' : 'person.badge.key.fill'}
        size={14}
        color={isOwner ? Colors.dustyMauve : Colors.primaryBlue}
      />
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        className="text-text1 text-[14px] flex-1"
      >
        {userRecordID}
      </Text>
      {isOwner ? (
        <Text
          style={{ fontFamily: MONO_FONT }}
          className="text-text2 text-[10px]"
        >
          (Owner)
        </Text>
      ) : null}
      {canRemove && onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel="Remove issuer"
          hitSlop={8}
          className="active:opacity-60"
        >
          <SfIcon
            name="minus.circle.fill"
            size={20}
            color={Colors.destructive}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
