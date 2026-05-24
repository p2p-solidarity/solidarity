/**
 * Sakura compose (CreateShoutoutView) — 1:1 port of
 * solidarity/Views/ShoutoutViews/CreateShoutoutView.swift +
 * ShoutoutUserPicker.swift.
 *
 * Layout (Swift parity):
 *   • Terminal header "SECURE TRANSMISSION / End-to-End Encrypted Payload".
 *   • TARGET NODE selector — tap opens a sheet of contacts (UserPicker).
 *   • PAYLOAD INPUT (MAX 200 BYTES) — monospaced TextEditor + counter.
 *   • TRANSMIT button (disabled until target + non-empty payload).
 *
 * Wiring: queues the message into `useShoutoutStore` so the relay send
 * (sakura client) can take over once signing-key + sealed routes
 * populate. Until then, the message is stored as an outgoing item.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ShoutoutUserPicker } from '@/components/shoutouts/ShoutoutUserPicker';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useContact } from '@/contacts/repository';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { SHOUTOUT_MAX_PAYLOAD_BYTES, useShoutoutStore } from '@/shoutouts/store';
import type { Contact } from '@solidarity/shared';

const MONO_FONT = 'Menlo';
const MAX_BYTES = SHOUTOUT_MAX_PAYLOAD_BYTES;

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export default function ShoutoutCompose(): ReactNode {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const presetRecipient = useContact(params.id);
  const add = useShoutoutStore((s) => s.add);

  const [recipient, setRecipient] = useState<Contact | null>(presetRecipient ?? null);
  const [message, setMessage] = useState('');
  const [showingPicker, setShowingPicker] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);

  const canSend =
    recipient !== null &&
    message.length > 0 &&
    message.length <= MAX_BYTES &&
    !isTransmitting;

  const onTransmit = async (): Promise<void> => {
    if (!recipient) return;
    setIsTransmitting(true);
    haptic('tap');
    try {
      await add({
        id: crypto.randomUUID(),
        direction: 'outgoing',
        counterpartName: recipient.businessCard.name,
        subject: message.slice(0, 64),
        body: message,
        createdAt: new Date(),
      });
      haptic('success');
      pushToast(
        `Payload encrypted and enqueued for ${recipient.businessCard.name}.`,
        'success'
      );
      router.back();
    } catch (err) {
      haptic('error');
      pushToast(`Protocol failure: ${(err as Error).message}`, 'error');
    } finally {
      setIsTransmitting(false);
    }
  };

  const setText = (text: string): void => {
    if (text.length <= MAX_BYTES) setMessage(text);
    else setMessage(text.slice(0, MAX_BYTES));
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="P2P Message" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 60 + insets.bottom, gap: 24 }}
      >
        <View
          className="bg-searchBg flex-row items-center"
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: Colors.divider,
          }}
        >
          <SfIcon
            name="envelope.badge.shield.half.filled"
            size={32}
            color={Colors.terminalGreen}
          />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text
              className="text-text1"
              style={{ fontSize: 16, fontWeight: '700', fontFamily: MONO_FONT }}
            >
              SECURE TRANSMISSION
            </Text>
            <Text
              className="text-text2"
              style={{ fontSize: 12, fontFamily: MONO_FONT, marginTop: 4 }}
            >
              End-to-End Encrypted Payload
            </Text>
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text
            className="text-text1"
            style={{ fontSize: 12, fontWeight: '700', fontFamily: MONO_FONT }}
          >
            TARGET NODE
          </Text>
          <Pressable
            onPress={() => { setShowingPicker(true); }}
            accessibilityRole="button"
            accessibilityLabel="Select target node"
          >
            <View
              className="bg-cardBg flex-row items-center"
              style={{
                padding: 16,
                borderWidth: 1,
                borderColor: Colors.divider,
                gap: 16,
              }}
            >
              {recipient ? (
                <>
                  <View
                    className="bg-primaryBlue items-center justify-center"
                    style={{
                      width: 48,
                      height: 48,
                      borderWidth: 1,
                      borderColor: Colors.primaryBlue,
                    }}
                  >
                    <Text
                      className="text-cardBg"
                      style={{ fontSize: 16, fontWeight: '700', fontFamily: MONO_FONT }}
                    >
                      {initials(recipient.businessCard.name)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      className="text-text1"
                      style={{ fontSize: 16, fontWeight: '700', fontFamily: MONO_FONT }}
                    >
                      {recipient.businessCard.name}
                    </Text>
                    {recipient.businessCard.company ? (
                      <Text
                        className="text-text2"
                        style={{ fontSize: 12, fontFamily: MONO_FONT }}
                      >
                        {recipient.businessCard.company}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : (
                <>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: Colors.divider,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <SfIcon
                      name="person.badge.plus"
                      size={20}
                      color={Colors.text2}
                    />
                  </View>
                  <Text
                    className="text-text2"
                    style={{ fontSize: 14, fontWeight: '700', fontFamily: MONO_FONT, flex: 1 }}
                  >
                    Select Target Node
                  </Text>
                </>
              )}
              <SfIcon
                name="chevron.right"
                size={10}
                weight="bold"
                color={Colors.text2}
              />
            </View>
          </Pressable>
        </View>

        <View style={{ gap: 8 }}>
          <Text
            className="text-text1"
            style={{ fontSize: 12, fontWeight: '700', fontFamily: MONO_FONT }}
          >
            PAYLOAD (MAX 200 BYTES)
          </Text>
          <View
            className="bg-searchBg"
            style={{
              padding: 12,
              borderWidth: 1,
              borderColor: Colors.divider,
            }}
          >
            <TextInput
              value={message}
              onChangeText={setText}
              multiline
              numberOfLines={6}
              style={{
                height: 120,
                color: Colors.text1,
                fontFamily: MONO_FONT,
                fontSize: 14,
                textAlignVertical: 'top',
              }}
            />
          </View>
          <Text
            style={{
              alignSelf: 'flex-end',
              fontSize: 10,
              fontWeight: '700',
              fontFamily: MONO_FONT,
              color:
                message.length >= MAX_BYTES ? Colors.destructive : Colors.text2,
            }}
          >
            [{String(message.length)}/{String(MAX_BYTES)}]
          </Text>
        </View>

        <View style={{ gap: 8, marginTop: 8 }}>
          <ThemedButton
            label={
              isTransmitting ? 'ENCRYPTING & SENDING...' : 'TRANSMIT'
            }
            fullWidth
            disabled={!canSend}
            loading={isTransmitting}
            leadingIcon={
              <SfIcon name="paperplane.fill" size={14} color={Colors.cardBg} />
            }
            onPress={() => void onTransmit()}
          />
        </View>
      </ScrollView>

      <ShoutoutUserPicker
        visible={showingPicker}
        singleSelect
        initialSelectedIds={recipient ? [recipient.id] : undefined}
        onConfirm={(picks) => {
          const first = picks[0];
          if (first) setRecipient(first);
          setShowingPicker(false);
        }}
        onCancel={() => { setShowingPicker(false); }}
      />
    </View>
  );
}
