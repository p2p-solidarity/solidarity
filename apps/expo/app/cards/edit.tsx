/**
 * Business card form — mirrors Swift BusinessCardFormView.
 * Create-only for now; edit-mode wires when the Me tab passes ?id=.
 */
import { useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useCardStore } from '@/cards/cardManager';
import { pushToast } from '@/feedback/toast';
import { haptic } from '@/feedback/haptics';

const NEW_ID = '00000000-0000-0000-0000-000000000000';

export default function CardForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const upsert = useCardStore((s) => s.upsert);

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const onSave = async () => {
    const cardId = id && id !== NEW_ID ? id : crypto.randomUUID();
    const now = new Date();
    const result = await upsert({
      id: cardId,
      name,
      title: title || undefined,
      company: company || undefined,
      email: email || undefined,
      phone: phone || undefined,
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
    });

    if (!result.ok) {
      Alert.alert('Cannot save', result.error.message);
      haptic('error');
      return;
    }
    haptic('success');
    pushToast('Card saved', 'success');
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Your card</ThemedText>
      </View>

      {[
        { label: 'NAME', value: name, onChange: setName, placeholder: 'Ada Lovelace' },
        { label: 'TITLE', value: title, onChange: setTitle, placeholder: 'Founder' },
        { label: 'COMPANY', value: company, onChange: setCompany, placeholder: 'Solidarity' },
        { label: 'EMAIL', value: email, onChange: setEmail, placeholder: 'ada@solidarity.gg' },
        { label: 'PHONE', value: phone, onChange: setPhone, placeholder: '+1 555 0100' },
      ].map((field) => (
        <ThemedSurface key={field.label} variant="card" padded className="mx-4 mb-2">
          <ThemedText variant="caption" tone="tertiary">
            {field.label}
          </ThemedText>
          <TextInput
            value={field.value}
            onChangeText={field.onChange}
            placeholder={field.placeholder}
            placeholderTextColor="#9C9C9C"
            autoCapitalize={field.label === 'EMAIL' ? 'none' : 'words'}
            keyboardType={
              field.label === 'EMAIL'
                ? 'email-address'
                : field.label === 'PHONE'
                  ? 'phone-pad'
                  : 'default'
            }
            className="text-text1 mt-1 py-1"
          />
        </ThemedSurface>
      ))}

      <View className="px-4 mt-4 mb-10">
        <ThemedButton
          label="Save card"
          fullWidth
          disabled={name.length === 0}
          onPress={() => void onSave()}
        />
      </View>
    </ScrollView>
  );
}
