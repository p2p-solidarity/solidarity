/**
 * AddIssuerSheet — 1:1 port of Swift AddIssuerView
 *   (solidarity/Views/IDViews/GroupDetailView/AddIssuerView.swift).
 *
 * Modal sheet listing every group member that is *not* already an issuer
 * or the owner. Each row tap calls `onSelect(member)` and dismisses.
 * Empty state mirrors Swift's "No eligible members found" + sub-line
 * ("All members are already issuers or the owner.").
 */
import type { ReactNode } from 'react';
import {
  FlatList,
  Modal,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type { GroupMember, GroupModel } from '@/groups/store';

const MONO_FONT = 'Menlo';

export interface AddIssuerSheetProps {
  readonly visible: boolean;
  readonly group: GroupModel;
  readonly members: readonly GroupMember[];
  readonly onSelect: (member: GroupMember) => void;
  readonly onClose: () => void;
}

export function AddIssuerSheet({
  visible,
  group,
  members,
  onSelect,
  onClose,
}: AddIssuerSheetProps): ReactNode {
  const insets = useSafeAreaInsets();
  const available = members.filter(
    (m) =>
      !group.credentialIssuers.includes(m.userRecordID) &&
      m.userRecordID !== group.ownerRecordID
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-pageBg">
        <View style={{ paddingTop: insets.top }} className="bg-pageBg">
          <View className="h-11 flex-row items-center px-4">
            <PressableScale
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
              className="px-1 py-1"
            >
              <Text className="text-text1 text-[16px]">Cancel</Text>
            </PressableScale>
            <View className="flex-1 items-center">
              <Text className="text-text1 text-[17px] font-semibold">
                Add Issuer
              </Text>
            </View>
            <View style={{ width: 60 }} />
          </View>
        </View>

        {available.length === 0 ? (
          <View
            className="flex-1 items-center justify-center"
            style={{ gap: 12, paddingHorizontal: 32 }}
          >
            <SfIcon name="person.2.slash" size={36} color={Colors.text2} />
            <Text
              style={{ fontFamily: MONO_FONT }}
              className="text-text1 text-[12px] font-bold"
            >
              No eligible members found
            </Text>
            <Text
              style={{ fontFamily: MONO_FONT, textAlign: 'center' }}
              className="text-text2 text-[10px]"
            >
              All members are already issuers or the owner.
            </Text>
          </View>
        ) : (
          <FlatList
            data={available}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ paddingVertical: 8 }}
            ItemSeparatorComponent={() => (
              <View
                style={{
                  height: 0.5,
                  backgroundColor: Colors.divider,
                  marginLeft: 16,
                }}
              />
            )}
            renderItem={({ item }) => (
              <PressableScale
                onPress={() => { onSelect(item); }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.userRecordID}`}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      className="text-text1 text-[14px]"
                    >
                      {item.userRecordID}
                    </Text>
                    <Text
                      style={{ fontFamily: MONO_FONT, marginTop: 2 }}
                      className="text-text2 text-[10px] capitalize"
                    >
                      {item.role}
                    </Text>
                  </View>
                  <SfIcon
                    name="plus.circle"
                    size={20}
                    color={Colors.primaryBlue}
                  />
                </View>
              </PressableScale>
            )}
          />
        )}
      </View>
    </Modal>
  );
}
