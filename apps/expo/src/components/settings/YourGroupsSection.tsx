/**
 * YourGroupsSection — 1:1 port of
 * solidarity/Views/SettingsViews/YourGroupsSectionView.swift.
 *
 * Splits group lists into three sub-sections (Public / Private (owned) /
 * Shared with you) with monospaced 12pt bold labels matching the Swift
 * design. Each card delegates onPress + onDelete to the parent so the
 * deletion confirmation dialog lives next to the data source.
 *
 * TODO(android): the Swift original reads ownership from
 * `groupManager.currentUserRecordID`. Until the CloudKit/Drive identity
 * layer is ported, ownership uses the local `CURRENT_USER_RECORD_ID`
 * constant from `@/groups/store`.
 */
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { GroupManagementCard } from '@/components/groups/GroupManagementCard';
import {
  useAllGroups,
  usePrivateOwnedGroups,
  usePrivateSharedGroups,
  usePublicGroups,
  type GroupModel,
} from '@/groups/store';

const MONO_FONT = 'Menlo';

export interface YourGroupsSectionProps {
  readonly onOpen: (group: GroupModel) => void;
  readonly onDelete: (group: GroupModel) => void;
}

export function YourGroupsSection({
  onOpen,
  onDelete,
}: YourGroupsSectionProps): ReactNode {
  const all = useAllGroups();
  const publicGroups = usePublicGroups();
  const ownedGroups = usePrivateOwnedGroups();
  const sharedGroups = usePrivateSharedGroups();

  return (
    <View className="gap-4">
      <Text
        className="text-text1 text-[12px] font-bold px-5 pt-2"
        style={{ fontFamily: MONO_FONT }}
      >
        Your Groups
      </Text>

      {all.length === 0 ? (
        <Text className="text-text2 text-[14px] px-5">
          No groups found. Create one to get started.
        </Text>
      ) : (
        <View className="gap-3">
          {publicGroups.length > 0 ? (
            <Subsection title="Public Groups">
              {publicGroups.map((g) => (
                <GroupManagementCard
                  key={g.id}
                  group={g}
                  onPress={() => { onOpen(g); }}
                  onDelete={() => { onDelete(g); }}
                />
              ))}
            </Subsection>
          ) : null}

          {ownedGroups.length > 0 ? (
            <Subsection title="Your Private Groups">
              {ownedGroups.map((g) => (
                <GroupManagementCard
                  key={g.id}
                  group={g}
                  onPress={() => { onOpen(g); }}
                  onDelete={() => { onDelete(g); }}
                />
              ))}
            </Subsection>
          ) : null}

          {sharedGroups.length > 0 ? (
            <Subsection title="Shared With You">
              {sharedGroups.map((g) => (
                <GroupManagementCard
                  key={g.id}
                  group={g}
                  onPress={() => { onOpen(g); }}
                  onDelete={() => { onDelete(g); }}
                />
              ))}
            </Subsection>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Subsection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <View className="gap-3 mt-1">
      <Text
        className="text-text2 text-[12px] font-bold px-5"
        style={{ fontFamily: MONO_FONT }}
      >
        {title}
      </Text>
      <View className="px-5 gap-4">{children}</View>
    </View>
  );
}
