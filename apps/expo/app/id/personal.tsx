/**
 * Personal Identity — 1:1 port of Swift PersonalIdentityView
 *   (solidarity/Views/IDViews/PersonalIdentityView.swift).
 *
 * Standalone screen wrapper that re-uses the shared <PersonalPanel>
 * sections (defined in `@/components/id/panels/PersonalPanel`) so the
 * same UI also powers the dashboard's "Personal" tab.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { IDNavBar } from '@/components/id';
import { PersonalPanel } from '@/components/id/panels/PersonalPanel';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useIdentityState, useZkIdentity } from '@/zk';

export default function PersonalIdentity(): React.JSX.Element {
  const { t } = useTranslation();
  const state = useIdentityState();
  const seedFromNative = useZkIdentity((s) => s.seedFromNative);
  const createIdentity = useZkIdentity((s) => s.createIdentity);
  const clearError = useZkIdentity((s) => s.clearError);

  useEffect(() => {
    void seedFromNative();
  }, [seedFromNative]);

  const onRefresh = (): void => {
    void createIdentity().then(() => {
      pushToast(t('personalIdentity.refreshed'), 'success');
    });
  };

  const onClearError = (): void => {
    clearError();
    pushToast(t('personalIdentity.errorCleared'), 'success');
  };

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar
        title={t('personalIdentity.title')}
        onLeading={() => { router.back(); }}
        trailing={
          <Pressable
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel={t('personalIdentity.refresh')}
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
