/**
 * People tab — mirrors Swift PeopleListView.
 *
 * Hosts the FlashList + a Pan gesture wrapping the whole scroll view so a
 * downward pull triggers `performBackupNow` (per user direction
 * 2026-05-24: "資料雲端自動儲存 react-native-gesture-handler"). The
 * gesture composes with the FlashList's native scroll via
 * `Gesture.Simultaneous` so we don't fight the JS-thread scroll.
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useMemo } from 'react';

import { makeGestureAutoBackup } from '@/backup';
import { ContactsList } from '@/components/people/ContactsList';
import { ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { usePeopleScreen } from '@/people/usePeopleScreen';
import { usePreferences } from '@/settings/preferences';
import type { Contact } from '@solidarity/shared';

export default function PeopleTab() {
  const { contacts, loading, refreshing, refresh } = usePeopleScreen();
  const provider = usePreferences((s) => s.backupProvider);
  const autoEnabled = usePreferences((s) => s.autoBackupOnPull);

  const onSelectContact = (c: Contact) => {
    router.push({
      pathname: '/people/[id]',
      params: { id: c.id, name: c.businessCard.name },
    });
  };

  const backupGesture = useMemo(
    () =>
      makeGestureAutoBackup(provider, {
        onComplete: () => { pushToast('Backed up to cloud', 'success', 2000); },
        onError: () => { pushToast('Backup failed', 'error'); },
      }),
    [provider]
  );

  const list = (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-2">
        <ThemedText variant="headlineLarge">People</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary">
          {String(contacts.length)} contacts
        </ThemedText>
      </View>
      <ContactsList
        contacts={contacts}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        onSelectContact={onSelectContact}
      />
    </View>
  );

  return (
    <View className="flex-1 bg-pageBg">
      {autoEnabled ? <GestureDetector gesture={backupGesture}>{list}</GestureDetector> : list}
    </View>
  );
}
