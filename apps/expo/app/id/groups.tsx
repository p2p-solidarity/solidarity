/**
 * Group Identity — 1:1 port of Swift GroupIdentityView
 *   (solidarity/Views/IDViews/GroupIdentityView.swift).
 *
 * Standalone screen wrapper that re-uses the shared <GroupPanel> sections
 * (defined in `@/components/id/panels/GroupPanel`) and owns the
 * <GroupJoinSheet> modal state.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { GroupJoinSheet } from '@/components/groups/GroupJoinSheet';
import { IDNavBar } from '@/components/id';
import { GroupPanel } from '@/components/id/panels/GroupPanel';

export default function GroupIdentity(): React.JSX.Element {
  const [joinVisible, setJoinVisible] = useState(false);

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar title="Group" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <GroupPanel onRequestJoin={() => { setJoinVisible(true); }} />
      </ScrollView>

      <GroupJoinSheet
        visible={joinVisible}
        onClose={() => { setJoinVisible(false); }}
      />
    </View>
  );
}
