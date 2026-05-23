/**
 * Personal Identity — 1:1 port of Swift PersonalIdentityView
 *   (solidarity/Views/IDViews/PersonalIdentityView.swift).
 *
 * Standalone screen wrapper that re-uses the shared <PersonalPanel>
 * sections (defined in `@/components/id/panels/PersonalPanel`) so the
 * same UI also powers the dashboard's "Personal" tab.
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { IDNavBar } from '@/components/id';
import {
  EMPTY_PERSONAL_STATE,
  PersonalPanel,
  type PersonalIdentityState,
} from '@/components/id/panels/PersonalPanel';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';

// TODO(android): swap for IdentityCoordinator.shared selectors once the
// coordinator port lands.
function useIdentityState(): PersonalIdentityState {
  return EMPTY_PERSONAL_STATE;
}

export default function PersonalIdentity(): React.JSX.Element {
  const state = useIdentityState();

  const onRefresh = (): void => {
    pushToast('Identity refresh lands next iteration', 'info');
  };

  const onClearError = (): void => {
    pushToast('Error cleared', 'success');
  };

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar
        title="Personal"
        onLeading={() => { router.back(); }}
        trailing={
          <Pressable
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            hitSlop={8}
            className="active:opacity-60"
          >
            <SfIcon name="arrow.clockwise" size={18} color={Colors.text1} />
          </Pressable>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <PersonalPanel
          state={state}
          onRefresh={onRefresh}
          onClearError={onClearError}
        />
      </ScrollView>
    </View>
  );
}
