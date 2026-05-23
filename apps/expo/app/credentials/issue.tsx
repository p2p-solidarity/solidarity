/**
 * Group VC issuance — mirrors Swift GroupVCIssuanceView.
 * Lets a group owner mint a verifiable credential and dispatch it via
 * one of the delivery methods (Sakura / Proximity / QR Code / AirDrop).
 *
 * Today: builds the VC payload in-memory and persists it locally. Real
 * issuance (sign with group key + push via delivery method) wires when
 * Phase 8.3 lands.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { useCredentialStore } from '@/credentials/store';
import { useGroup } from '@/groups/store';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';

type Delivery = 'Sakura' | 'Proximity' | 'QR Code' | 'AirDrop';

const DELIVERY_OPTIONS: readonly Delivery[] = ['Sakura', 'Proximity', 'QR Code', 'AirDrop'];

export default function IssueCredential() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const group = useGroup(groupId);
  const addCredential = useCredentialStore((s) => s.add);
  const [claimType, setClaimType] = useState('member');
  const [title, setTitle] = useState(group ? `${group.name} member` : '');
  const [delivery, setDelivery] = useState<Delivery>('Sakura');

  const onIssue = async () => {
    const id = crypto.randomUUID();
    await addCredential({
      id,
      type: claimType,
      title,
      issuerDid: group ? `did:web:solidarity.gg/group/${group.id}` : 'did:key:local',
      holderDid: 'did:key:me',
      trustLevel: 'L2',
      rawJwt: 'unsigned.placeholder.jwt',
      issuedAt: new Date(),
      metadataTags: [delivery.toLowerCase()],
    });
    pushToast(`Issued "${title}" via ${delivery}`, 'success');
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6">
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => { router.back(); }} />
      </View>
      <View className="px-4 py-4">
        <ThemedText variant="headlineLarge">Issue credential</ThemedText>
        {group ? (
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
            for {group.name}
          </ThemedText>
        ) : null}
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">TITLE</ThemedText>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Founders Member"
          placeholderTextColor="#9C9C9C"
          className="text-text1 mt-1 py-1"
        />
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-3">
        <ThemedText variant="caption" tone="tertiary">CLAIM TYPE</ThemedText>
        <TextInput
          value={claimType}
          onChangeText={setClaimType}
          placeholder="member"
          placeholderTextColor="#9C9C9C"
          autoCapitalize="none"
          className="text-text1 mt-1 py-1"
        />
      </ThemedSurface>

      <View className="px-4 mt-6">
        <ThemedText variant="caption" tone="tertiary">DELIVERY METHOD</ThemedText>
        <View className="flex-row flex-wrap mt-2" style={{ gap: 8 }}>
          {DELIVERY_OPTIONS.map((opt) => (
            <ThemedButton
              key={opt}
              label={opt}
              size="sm"
              variant={opt === delivery ? 'primary' : 'secondary'}
              onPress={() => { setDelivery(opt); }}
            />
          ))}
        </View>
      </View>

      <View className="px-4 mt-6 mb-10">
        <ThemedButton
          label="Issue credential"
          fullWidth
          disabled={title.trim().length === 0}
          onPress={() => { void onIssue(); }}
        />
      </View>
    </ScrollView>
  );
}
