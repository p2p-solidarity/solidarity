/**
 * Shoutout compose — mirrors Swift CreateShoutoutView.
 * Pick a recipient from contacts + write subject/body. On send: seals
 * with Sakura ECIES + posts to relay via sakura client (TODO: wire send
 * once signing key + sealed routes are populated).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useContactList } from '@/contacts/repository';
import { pushToast } from '@/feedback/toast';
import { useShoutoutStore } from '@/shoutouts/store';
import type { Contact } from '@solidarity/shared';

export default function ShoutoutCompose() {
  const contacts = useContactList();
  const add = useShoutoutStore((s) => s.add);
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const onSend = async () => {
    if (!recipient || subject.length === 0) {
      pushToast('Pick a recipient + add a subject', 'warning');
      return;
    }
    await add({
      id: crypto.randomUUID(),
      direction: 'outgoing',
      counterpartName: recipient.businessCard.name,
      subject,
      body,
      createdAt: new Date(),
    });
    pushToast('Message queued (relay send wires after key exchange)', 'success');
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">New Sakura</ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">TO</ThemedText>
        {contacts.length === 0 ? (
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-2">
            No contacts to send to yet.
          </ThemedText>
        ) : (
          <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
            {contacts.map((c) => (
              <ThemedButton
                key={c.id}
                size="sm"
                variant={recipient?.id === c.id ? 'primary' : 'secondary'}
                label={c.businessCard.name}
                onPress={() => { setRecipient(c); }}
              />
            ))}
          </View>
        )}
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-3">
        <ThemedText variant="caption" tone="tertiary">SUBJECT</ThemedText>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder="Coffee tomorrow?"
          placeholderTextColor="#9C9C9C"
          className="text-text1 mt-1"
        />
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-3">
        <ThemedText variant="caption" tone="tertiary">BODY</ThemedText>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Optional message…"
          placeholderTextColor="#9C9C9C"
          multiline
          numberOfLines={6}
          className="text-text1 mt-1"
          style={{ minHeight: 120, textAlignVertical: 'top' }}
        />
      </ThemedSurface>

      <View className="px-4 mt-6 mb-10">
        <ThemedButton label="Send (end-to-end encrypted)" fullWidth onPress={() => void onSend()} />
      </View>
    </ScrollView>
  );
}
