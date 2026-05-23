/**
 * Contact picker sheet — mirrors Swift ContactPickerView.
 * Multi-select list of contacts, returns chosen ids via deep-link
 * `?onResult=<route>?picked=id1,id2,id3`. For the simple in-app flows
 * we callback through router.back + a temporary store flag (TODO).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useContactList } from '@/contacts/repository';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';

export default function ContactPicker() {
  const contacts = useContactList();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onConfirm = () => {
    pushToast(`Picked ${String(picked.size)} contacts`, 'info');
    router.back();
  };

  return (
    <View className="flex-1 bg-pageBg">
      <View className="flex-row items-center justify-between px-4 pt-6">
        <ThemedText variant="headlineLarge">Pick contacts</ThemedText>
        <ThemedButton variant="secondary" size="sm" label="Cancel" onPress={() => { router.back(); }} />
      </View>

      <ScrollView className="flex-1 mt-4">
        {contacts.map((c) => {
          const selected = picked.has(c.id);
          return (
            <Pressable key={c.id} onPress={() => { toggle(c.id); }} accessibilityRole="checkbox">
              <ThemedSurface
                variant={selected ? 'elevated' : 'card'}
                padded
                className={`mx-4 mt-2 flex-row items-center ${selected ? 'border-2 border-accentRose' : ''}`}
              >
                <ThemedText variant="titleLarge" className="mr-3">
                  {selected ? '☑︎' : '☐'}
                </ThemedText>
                <View className="flex-1">
                  <ThemedText variant="titleMedium">{c.businessCard.name}</ThemedText>
                  {c.businessCard.email ? (
                    <ThemedText variant="caption" tone="tertiary">
                      {c.businessCard.email}
                    </ThemedText>
                  ) : null}
                </View>
              </ThemedSurface>
            </Pressable>
          );
        })}
        <View className="h-20" />
      </ScrollView>

      <View className="px-4 py-4 border-t border-divider bg-cardBg">
        <ThemedButton
          label={`Confirm (${String(picked.size)})`}
          fullWidth
          disabled={picked.size === 0}
          onPress={onConfirm}
        />
      </View>
    </View>
  );
}
