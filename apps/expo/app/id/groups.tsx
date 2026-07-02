/**
 * Group Identity — 1:1 port of Swift GroupIdentityView
 *   (solidarity/Views/IDViews/GroupIdentityView.swift).
 *
 * Standalone screen wrapper that re-uses the shared <GroupPanel> sections
 * (defined in `@/components/id/panels/GroupPanel`).
 */
import { ScrollView, View } from 'react-native';

import { IDNavBar } from '@/components/id';
import { GroupPanel } from '@/components/id/panels/GroupPanel';
import { useTranslation } from '@/i18n';

export default function GroupIdentity(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar title={t('groupIdentity.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <GroupPanel />
      </ScrollView>
    </View>
  );
}
