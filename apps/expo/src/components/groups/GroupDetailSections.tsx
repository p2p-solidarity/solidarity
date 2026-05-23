/**
 * GroupDetailSections — 1:1 port of the section subviews in
 * solidarity/Views/IDViews/GroupDetailView+Subviews.swift
 * and GroupDetailView+MemberViews.swift.
 *
 * Each exported component matches one Swift struct so the detail screen
 * stays under the 500-line cap.
 */
import * as Clipboard from 'expo-clipboard';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import {
  CURRENT_USER_RECORD_ID,
  isOwner as isOwnerOf,
  type GroupModel,
} from '@/groups/store';

const MONO_FONT = 'Menlo';

/* ------------------------------------------------------------------ */
/* Section frame helpers                                              */
/* ------------------------------------------------------------------ */

export function SectionHeader({ title }: { readonly title: string }): ReactNode {
  return (
    <Text
      className="text-text2 text-[12px] font-bold"
      style={{ fontFamily: MONO_FONT }}
    >
      {title}
    </Text>
  );
}

function SectionCard({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <View
      className="bg-searchBg p-4"
      style={{ borderWidth: 1, borderColor: Colors.divider }}
    >
      {children}
    </View>
  );
}

function LabeledRow({
  label,
  value,
  selectable = false,
  mono = false,
  tone = 'primary',
}: {
  readonly label: string;
  readonly value: string;
  readonly selectable?: boolean;
  readonly mono?: boolean;
  readonly tone?: 'primary' | 'secondary';
}): ReactNode {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1">
      <Text
        className={`${tone === 'secondary' ? 'text-text2' : 'text-text1'} text-[15px]`}
      >
        {label}
      </Text>
      <Text
        selectable={selectable}
        numberOfLines={1}
        ellipsizeMode="middle"
        className={`${tone === 'secondary' ? 'text-text2' : 'text-text1'} text-[13px] flex-1 text-right`}
        style={mono ? { fontFamily: MONO_FONT } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Group Info                                                         */
/* ------------------------------------------------------------------ */

export function GroupInfoSection({
  group,
  memberCount,
}: {
  readonly group: GroupModel;
  readonly memberCount: number;
}): ReactNode {
  const owner = isOwnerOf(group);
  const isIssuer = group.credentialIssuers.includes(CURRENT_USER_RECORD_ID);

  return (
    <View className="gap-3">
      <SectionHeader title="Group Info" />

      {owner ? (
        <View className="flex-row items-center gap-2">
          <SfIcon name="crown.fill" size={12} color={Colors.dustyMauve} />
          <Text className="text-dustyMauve text-[12px]">You are the owner</Text>
        </View>
      ) : isIssuer ? (
        <View className="flex-row items-center gap-2">
          <SfIcon name="person.badge.key.fill" size={12} color={Colors.primaryBlue} />
          <Text className="text-primaryBlue text-[12px]">
            You can issue Group VCs
          </Text>
        </View>
      ) : null}

      <SectionCard>
        <LabeledRow label="Name" value={group.name} />
        {group.description.length > 0 ? (
          <LabeledRow label="Description" value={group.description} />
        ) : null}
        <LabeledRow
          label="ID"
          value={group.id}
          selectable
          mono
          tone="secondary"
        />
        <LabeledRow label="Members" value={String(memberCount)} />
      </SectionCard>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Merkle Tree                                                        */
/* ------------------------------------------------------------------ */

export function MerkleTreeSection({
  group,
}: {
  readonly group: GroupModel;
}): ReactNode {
  // TODO(android): wire to SemaphoreGroupManager port. The Swift screen
  // pulls semaphoreManager.merkleRoot + recomputeRoot + index lookup.
  const root = group.merkleRoot;

  return (
    <View className="gap-3">
      <SectionHeader title="Merkle Tree" />

      <SectionCard>
        {root ? (
          <View className="gap-1">
            <Text className="text-text2 text-[12px]">Root Hash</Text>
            <Text
              selectable
              className="text-text1 text-[12px] p-2 bg-searchBg rounded-lg"
              style={{ fontFamily: MONO_FONT }}
            >
              {root}
            </Text>
          </View>
        ) : (
          <Text className="text-text2 text-[15px]">No Root Calculated</Text>
        )}

        <View className="mt-3">
          <ThemedButton
            variant="secondary"
            label="Recompute Root"
            fullWidth
            leadingIcon={
              <SfIcon
                name="arrow.triangle.2.circlepath"
                size={14}
                color={Colors.accentRose}
              />
            }
            onPress={() => {
              pushToast('Merkle recompute lands next iteration', 'info');
            }}
          />
        </View>

        {/* TODO(android): show leaf-index membership line once Semaphore is ported. */}
      </SectionCard>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Invite Members                                                     */
/* ------------------------------------------------------------------ */

export function InviteSection({
  group,
}: {
  readonly group: GroupModel;
}): ReactNode {
  // TODO(android): generate the real invite link via the backup-provider
  // share token. For now we synthesise a deep link so the QR + copy flow
  // still work locally.
  const link = `solidarity://groups/join?gid=${group.id}`;
  const [showQr, setShowQr] = useState(false);

  return (
    <View className="gap-4 rounded-xl bg-searchBg p-4" style={{ borderWidth: 1, borderColor: Colors.divider }}>
      <View className="flex-row items-center">
        <SectionHeader title="Invite Members" />
        <View className="flex-1" />
      </View>

      <View className="flex-row items-center gap-2">
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          className="text-text1 text-[15px] flex-1 p-2 bg-searchBg rounded-lg"
          style={{ fontFamily: MONO_FONT }}
        >
          {link}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy invite link"
          onPress={() => {
            void Clipboard.setStringAsync(link);
            pushToast('Copied to clipboard', 'success');
          }}
          className="p-2 rounded-full"
          style={{ backgroundColor: `${Colors.primaryBlue}1A` }}
        >
          <SfIcon name="doc.on.doc" size={12} color={Colors.primaryBlue} />
        </Pressable>
      </View>

      <ThemedButton
        variant="secondary"
        label={showQr ? 'Hide QR Code' : 'Show QR Code'}
        fullWidth
        leadingIcon={<SfIcon name="qrcode" size={14} color={Colors.accentRose} />}
        onPress={() => { setShowQr((v) => !v); }}
      />

      {showQr ? (
        <View
          className="items-center justify-center p-4 self-center bg-cardBg"
          style={{ borderRadius: 12 }}
        >
          <QRCode value={link} size={180} backgroundColor="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Identity Info (OIDC)                                               */
/* ------------------------------------------------------------------ */

export function IdentityInfoSection({
  group,
}: {
  readonly group: GroupModel;
}): ReactNode {
  // TODO(android): pull real values from a ported SemaphoreIdentityManager.
  const userId = CURRENT_USER_RECORD_ID;

  return (
    <View className="gap-3">
      <SectionHeader title="Identity Info" />

      <SectionCard>
        <View className="gap-1">
          <Text className="text-text2 text-[12px]">User ID</Text>
          <Text
            selectable
            className="text-text1 text-[12px]"
            style={{ fontFamily: MONO_FONT }}
          >
            {userId}
          </Text>
        </View>

        <View
          style={{
            height: 0.5,
            backgroundColor: Colors.divider,
            marginVertical: 12,
          }}
        />

        <View className="gap-1">
          <Text className="text-text2 text-[12px]">
            Leaf Hash (Commitment)
          </Text>
          <Text className="text-accentRose text-[12px]">
            Identity not initialized
          </Text>
        </View>

        <View className="mt-3">
          <ThemedButton
            variant="secondary"
            label="Generate Group Proof"
            fullWidth
            leadingIcon={
              <SfIcon name="lock.doc.fill" size={14} color={Colors.accentRose} />
            }
            onPress={() => {
              pushToast(
                `Group proof for "${group.name}" lands next iteration`,
                'info'
              );
            }}
          />
        </View>
      </SectionCard>
    </View>
  );
}

