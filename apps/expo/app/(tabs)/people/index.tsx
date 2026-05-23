/**
 * People tab — mirrors Swift PeopleListView. Renders ContactsList (FlashList)
 * and routes taps into the detail sheet.
 *
 * Render path keeps `useState` count low; all the hard work is inside the
 * `usePeopleScreen()` hook. Per aniseekr-expo rule 10, the cache hit (MMKV
 * is sync) means we never flash a skeleton on warm starts once `useEffect`
 * resolves.
 */
import { router } from 'expo-router';
import { View } from 'react-native';

import { ContactsList } from '@/components/people/ContactsList';
import { ThemedText } from '@/components/themed';
import { usePeopleScreen } from '@/people/usePeopleScreen';
import type { Contact } from '@solidarity/shared';

export default function PeopleTab() {
  const { contacts, loading, refreshing, refresh } = usePeopleScreen();

  const onSelectContact = (c: Contact) => {
    router.push({
      pathname: '/people/[id]',
      params: { id: c.id, name: c.businessCard.name },
    });
  };

  return (
    <View className="flex-1 bg-pageBg">
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
}
