/**
 * MatchingRoot — 1:1 port of MatchingRootView.swift.
 *
 * Orchestrator that owns the orbit visualization, the NearbyPeersSheet,
 * the ShareCardPickerSheet, the IncomingInvitationPopup, and the chat
 * composer overlay (preset chips + text input + sakura pulse button).
 *
 * Layout (z-order, bottom → top):
 *   1. MatchingOrbit (centre, taps the Nearby disk → NearbyPeersSheet)
 *   2. UWB spatial pill (top)
 *   3. latest message banner (top — 60pt under safe area)
 *   4. composer overlay (bottom — appears once any peer is connected)
 *   5. IncomingInvitationPopup (above all — when invites are pending)
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';
import { UwbStatusPill } from '@/components/share/UwbStatusPill';
import { useMatchingSession } from '@/matching/session';
import { useMyCard } from '@/cards/cardManager';

import { IncomingInvitationPopup } from './IncomingInvitationPopup';
import { MatchingOrbit } from './MatchingOrbit';
import { NearbyPeersSheet } from './NearbyPeersSheet';
import { ShareCardPickerSheet } from './ShareCardPickerSheet';
import type { MatchingPeer } from '@/matching/types';

const PRESETS: readonly string[] = [
  'Hi 👋',
  'Nice to meet you!',
  "Let's stay in touch 🤝",
  'Coffee? ☕',
  'Thanks! 🙏',
];

export interface MatchingRootProps {
  /** Size of the orbit visualization. */
  readonly orbitSize?: number;
  /** When true, also renders the share-card picker entry point. */
  readonly enableSharePicker?: boolean;
}

export function MatchingRoot({
  orbitSize = 260,
  enableSharePicker = false,
}: MatchingRootProps): ReactNode {
  const peers = useMatchingSession((s) => s.peers);
  const isAdvertising = useMatchingSession((s) => s.isAdvertising);
  const pendingInvitations = useMatchingSession((s) => s.pendingInvitations);
  const latestMessage = useMatchingSession((s) => s.latestMessage);
  const uwbSpatial = useMatchingSession((s) => s.uwbSpatial);
  const sendText = useMatchingSession((s) => s.sendText);
  const sendSakura = useMatchingSession((s) => s.sendSakura);
  const accept = useMatchingSession((s) => s.acceptInvitation);
  const decline = useMatchingSession((s) => s.declineInvitation);
  const startAdvertising = useMatchingSession((s) => s.startAdvertising);
  const stopAdvertising = useMatchingSession((s) => s.stopAdvertising);

  const card = useMyCard();
  const [showNearby, setShowNearby] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const hasConnected = peers.some((p) => p.status === 'connected');
  const currentInvitation = pendingInvitations[0];

  return (
    <View style={styles.root}>
      {uwbSpatial.kind !== 'idle' ? (
        <View style={styles.uwb}>
          <UwbStatusPill state={uwbSpatial} />
        </View>
      ) : null}

      {latestMessage ? (
        <View style={styles.messageBanner} pointerEvents="none">
          <View style={styles.messageBubble} key={latestMessage.timestamp}>
            <Text style={styles.messageText}>{latestMessage.content}</Text>
          </View>
        </View>
      ) : null}

      <MatchingOrbit
        size={orbitSize}
        nearbyCount={peers.length}
        onCenterTap={() => { setShowNearby(true); }}
      />

      {hasConnected ? (
        <Composer onSendText={sendText} onSendSakura={sendSakura} />
      ) : null}

      {enableSharePicker ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share card"
          onPress={() => { setShowPicker(true); }}
          style={styles.sharePill}
        >
          <Text style={styles.sharePillText}>
            {isAdvertising ? 'Sharing' : 'Share'}
          </Text>
        </Pressable>
      ) : null}

      <NearbyPeersSheet
        visible={showNearby}
        onClose={() => { setShowNearby(false); }}
        onViewLatestCard={() => { setShowNearby(false); }}
        onSelectPeer={(p: MatchingPeer) => {
          // Future PeerDetail port could push a route here; for now we
          // close the sheet so the connect popup (NearbyPeersSheet owns
          // its own) gets focus.
          void p;
        }}
      />

      <ShareCardPickerSheet
        visible={showPicker}
        card={card}
        initialLevel="professional"
        isAdvertising={isAdvertising}
        onStart={(c, level) => {
          void startAdvertising(c.name, level, {
            name: c.name,
            ...(c.title ? { title: c.title } : {}),
            ...(c.company ? { company: c.company } : {}),
            ...(c.animal ? { animal: c.animal } : {}),
          });
        }}
        onStop={() => { void stopAdvertising(); }}
        onClose={() => { setShowPicker(false); }}
      />

      {currentInvitation ? (
        <IncomingInvitationPopup
          peerId={currentInvitation.peerId}
          onAccept={() => { void accept(currentInvitation.peerId); }}
          onDecline={() => { void decline(currentInvitation.peerId); }}
          onDismiss={() => {
            // Auto-decline if the user dismisses without responding so we
            // don't leave dangling MultipeerConnectivity invitations.
            void decline(currentInvitation.peerId);
          }}
        />
      ) : null}
    </View>
  );
}

function Composer({
  onSendText,
  onSendSakura,
}: {
  readonly onSendText: (text: string) => void;
  readonly onSendSakura: () => void;
}): ReactNode {
  const [draft, setDraft] = useState('');
  const sakuraScale = useSharedValue(1);
  const sendScale = useSharedValue(1);

  const sakuraStyle = useAnimatedStyle(() => ({ transform: [{ scale: sakuraScale.value }] }));
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.value }] }));

  const sendDraft = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    onSendText(text);
    setDraft('');
    sendScale.value = withSequence(
      withTiming(0.82, { duration: 110 }),
      withTiming(1, { duration: 110 })
    );
  };

  const triggerSakura = (): void => {
    onSendSakura();
    sakuraScale.value = withSequence(
      withTiming(1.25, { duration: 175 }),
      withTiming(1, { duration: 175 })
    );
  };

  const canSend = draft.trim().length > 0;

  return (
    <View style={styles.composer} pointerEvents="box-none">
      <View style={styles.composerInner}>
        <PresetRow onSelect={onSendText} />
        <View style={styles.inputRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send sakura"
            onPress={triggerSakura}
          >
            <Animated.View style={[styles.sakuraButton, sakuraStyle]}>
              <Text style={styles.sakuraEmoji}>🌸</Text>
            </Animated.View>
          </Pressable>
          <View style={styles.inputPill}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Send a message…"
              placeholderTextColor={Colors.text3}
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={sendDraft}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={sendDraft}
              disabled={!canSend}
            >
              <Animated.View style={sendStyle}>
                <Text
                  style={[styles.sendIcon, canSend ? styles.sendIconActive : null]}
                >
                  ⬆︎
                </Text>
              </Animated.View>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function PresetRow({ onSelect }: { readonly onSelect: (text: string) => void }): ReactNode {
  return (
    <View style={styles.presetRow}>
      {PRESETS.map((msg) => (
        <Pressable
          key={msg}
          accessibilityRole="button"
          accessibilityLabel={msg}
          onPress={() => { onSelect(msg); }}
          style={styles.presetChip}
        >
          <Text style={styles.presetText}>{msg}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  uwb: { position: 'absolute', top: 8, alignSelf: 'center', zIndex: 2 },
  messageBanner: { position: 'absolute', top: 60, alignSelf: 'center', zIndex: 1 },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.overlayBg,
  },
  messageText: { color: Colors.text1, fontSize: 24, fontWeight: '700' },

  composer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composerInner: { paddingHorizontal: 12, paddingBottom: 24, gap: 10 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.pillBg,
    borderWidth: 1,
    borderColor: Colors.pillBorder,
  },
  presetText: { color: Colors.text1, fontSize: 14, fontWeight: '500' },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sakuraButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sakuraEmoji: { fontSize: 22 },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.mutedSurface,
  },
  input: { flex: 1, color: Colors.text1, fontSize: 15, padding: 0 },
  sendIcon: { fontSize: 28, color: Colors.text3 },
  sendIconActive: { color: Colors.accentRose },

  sharePill: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  sharePillText: { color: Colors.text1, fontSize: 13, fontWeight: '600' },
});
