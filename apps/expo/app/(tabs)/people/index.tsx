/**
 * People tab — mirrors Swift PeopleListView. 1:1 strings + actions:
 *   navigation title: "People"
 *   empty state:      "Your contact list is empty"
 *   add menu:         Radar Exchange / Add Manually / Import from Phone / Import VCF File
 *
 * Pan gesture wraps the scroll view so a downward pull triggers
 * `performBackupNow` (per user direction 2026-05-24).
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { makeGestureAutoBackup } from '@/backup';
import { ContactsList } from '@/components/people/ContactsList';
import { ThemedButton, ThemedText } from '@/components/themed';
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
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <ThemedText variant="headlineLarge">People</ThemedText>
        <ThemedButton
          label="+"
          size="sm"
          onPress={() => {
            pushToast('Add menu (radar / manual / phone / VCF) lands next pass', 'info');
          }}
        />
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
