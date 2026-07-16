import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { MeProfileGate, MeProfilePage } from '@/components/me';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import { useProfileStore } from '@/profile/store';

export default function MeTab() {
  const insets = useSafeAreaInsets();
  const record = useProfileStore((state) => state.record);
  const jws = useProfileStore((state) => state.jws);
  const status = useProfileStore((state) => state.status);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <MeNavBar
        onSettings={() => {
          router.push('/settings');
        }}
      />

      {status === 'ready' && record && jws ? (
        <MeProfilePage
          record={record}
          jws={jws}
          bottomInset={insets.bottom}
          onEdit={() => {
            router.push('/me/edit');
          }}
          onOpenIdentity={() => {
            router.push({ pathname: '/settings/dids', params: { did: record.did } });
          }}
          onOpenBindings={() => {
            router.push('/verify/nostr');
          }}
          onOpenCredentials={() => {
            router.push('/credentials');
          }}
          onOpenShareSettings={() => {
            router.push('/settings/share-settings');
          }}
        />
      ) : (
        <MeProfileGate
          onCreatePage={() => {
            router.push('/me/edit');
          }}
          onSetUpIdentity={() => {
            router.push('/onboarding?replay=1');
          }}
        />
      )}
    </View>
  );
}

function MeNavBar({ onSettings }: { readonly onSettings: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center justify-between px-4" style={{ height: 44 }}>
      <View style={{ width: 44 }} />
      <ThemedText variant="titleMedium">{t('tab.me')}</ThemedText>
      <PressableScale
        haptic="tap"
        scaleTo={SCALE.icon}
        onPress={onSettings}
        accessibilityRole="button"
        accessibilityLabel={t('meTab.settings')}
        style={{ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
        <SfIcon name="gearshape" size={18} color={Colors.text1} />
      </PressableScale>
    </View>
  );
}
