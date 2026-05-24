/**
 * Manual contact entry — mirrors Swift ManualContactEntrySheet.
 * Lets the user paste a name + optional email + optional phone and persist
 * a Contact straight to the zustand store.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useContactStore } from '@/contacts/repository';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { uuid } from '@solidarity/shared';

export default function ManualContactEntry() {
  const upsert = useContactStore((s) => s.upsert);
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');

  const onSave = async () => {
    if (name.trim().length === 0) {
      pushToast('Name is required', 'warning');
      return;
    }
    const now = new Date();
    await upsert({
      id: uuid(),
      receivedAt: now,
      source: 'Manual',
      tags: [],
      verificationStatus: 'Unverified',
      businessCard: {
        id: uuid(),
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        socialNetworks: [],
        skills: [],
        categories: [],
        sharingPreferences: {
          publicFields: new Set(['name']),
          professionalFields: new Set(['name', 'title', 'company', 'email']),
          personalFields: new Set(['name', 'email', 'phone']),
          allowForwarding: true,
          useZK: false,
          sharingFormat: 'didSigned',
        },
        verifiedFields: undefined,
        nameType: 'display_name',
        createdAt: now,
        updatedAt: now,
      },
    });
    pushToast(`Saved ${name}`, 'success');
    router.back();
  };

  return (
    <ScrollView
      className="flex-1 bg-pageBg"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      <View className="px-4" style={{ paddingTop: insets.top + 12 }}>
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => { router.back(); }} />
      </View>
      <View className="px-4 py-4">
        <ThemedText variant="headlineLarge">Add contact</ThemedText>
      </View>

      {[
        { label: 'NAME', value: name, set: setName, placeholder: 'Ada Lovelace' },
        { label: 'EMAIL', value: email, set: setEmail, placeholder: 'ada@solidarity.gg' },
        { label: 'PHONE', value: phone, set: setPhone, placeholder: '+1 555 0100' },
        { label: 'COMPANY', value: company, set: setCompany, placeholder: 'Solidarity' },
      ].map((f) => (
        <ThemedSurface key={f.label} variant="card" padded className="mx-4 mb-2">
          <ThemedText variant="caption" tone="tertiary">{f.label}</ThemedText>
          <TextInput
            value={f.value}
            onChangeText={f.set}
            placeholder={f.placeholder}
            placeholderTextColor="#9C9C9C"
            autoCapitalize={f.label === 'EMAIL' ? 'none' : 'words'}
            keyboardType={
              f.label === 'EMAIL' ? 'email-address' : f.label === 'PHONE' ? 'phone-pad' : 'default'
            }
            className="text-text1 mt-1 py-1"
          />
        </ThemedSurface>
      ))}

      <View className="px-4 mt-4 mb-10">
        <ThemedButton
          label="Save contact"
          fullWidth
          disabled={name.trim().length === 0}
          onPress={() => { void onSave(); }}
        />
      </View>
    </ScrollView>
  );
}
