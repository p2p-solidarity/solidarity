/**
 * Contacts picker shim — kept as a deep-link / legacy redirect target so
 * older nav paths still land on something useful. The bulk-import flow has
 * been replaced by `/contacts/import-phone` which surfaces a multi-select
 * list (see `apps/expo/app/contacts/import-phone.tsx`) so users pick which
 * contacts to bring across instead of getting their entire address book
 * dumped on first tap.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

export default function ContactPicker() {
  useEffect(() => {
    router.replace('/contacts/import-phone');
  }, []);
  return <View className="flex-1 bg-pageBg" />;
}
