/**
 * Contacts picker shim — mirrors Swift `ContactPickerView` which presents
 * `CNContactPickerViewController` on iOS. We don't have a native multi-
 * select picker on Android (or iOS via Expo today), so the screen kicks
 * off the bulk device-contact import and bounces back to People. The
 * People tab's "Import from Phone" path calls `importFromDevice()`
 * directly; this route exists for any deeplink / legacy nav.
 */
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { importFromDevice } from '@/contacts/importer';
import { pushToast } from '@/feedback/toast';

export default function ContactPicker() {
  const insets = useSafeAreaInsets();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void (async () => {
      try {
        const { granted, count } = await importFromDevice();
        if (!granted) {
          pushToast('Contacts permission denied', 'warning');
        } else {
          pushToast(`Imported ${String(count)} contacts`, 'success', 3000);
        }
      } catch {
        pushToast('Import failed', 'error');
      } finally {
        router.back();
      }
    })();
  }, []);

  return (
    <View
      className="flex-1 bg-pageBg items-center justify-center"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ActivityIndicator />
      <Text className="text-text2 text-[14px]" style={{ marginTop: 12 }}>
        Importing contacts…
      </Text>
    </View>
  );
}
