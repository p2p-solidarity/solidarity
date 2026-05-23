/**
 * IncomingInvitationPopup — 1:1 port of IncomingInvitationPopupView.swift.
 *
 * Renders a single pending invitation as a centred Accept/Decline modal.
 * The header avatar pulses (1.0 → 1.1) on a 0.6s loop while the user
 * decides. Once the user taps either button, the response is forwarded
 * via callbacks; the parent decides whether to dismiss / queue the next
 * invite.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { ON_DARK, ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useMatchingSession } from '@/matching/session';
import { defaultAnimalForId } from '@solidarity/shared';

import { PeerAvatar } from './PeerAvatar';

export interface IncomingInvitationPopupProps {
  readonly peerId: string;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onDismiss: () => void;
}

export function IncomingInvitationPopup({
  peerId,
  onAccept,
  onDecline,
  onDismiss,
}: IncomingInvitationPopupProps): ReactNode {
  const peer = useMatchingSession((s) => s.peers.find((p) => p.peerId === peerId));
  const [didRespond, setDidRespond] = useState(false);

  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [scale]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const name = peer?.cardName ?? peer?.displayName ?? peerId;
  const animal = peer?.cardAnimal ?? defaultAnimalForId(peerId);
  const status = peer?.status ?? 'disconnected';
  const statusColor = status === 'connected'
    ? Colors.terminalGreen
    : status === 'connecting'
      ? Colors.warning
      : Colors.text3;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.avatarWrap}>
              <PeerAvatar animal={animal} size={54} ringColor={statusColor} />
              <Animated.View
                pointerEvents="none"
                style={[styles.pulseRing, ringStyle]}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
              {peer?.cardTitle ? (
                <Text style={styles.headerTitle} numberOfLines={1}>{peer.cardTitle}</Text>
              ) : null}
              {peer?.cardCompany ? (
                <Text style={styles.headerCompany} numberOfLines={1}>{peer.cardCompany}</Text>
              ) : null}
            </View>
            <SfIcon
              name={status === 'connected' ? 'circle.fill' : status === 'connecting' ? 'circle.dotted' : 'circle'}
              size={18}
              color={statusColor}
            />
          </View>

          <Text style={styles.body}>wants to connect with you</Text>

          <View style={styles.actions}>
            <View style={styles.flex}>
              <ThemedButton
                fullWidth
                variant="secondary"
                label="Decline"
                onPress={() => {
                  if (didRespond) return;
                  setDidRespond(true);
                  onDecline();
                }}
              />
            </View>
            <View style={styles.flex}>
              <ThemedButton
                fullWidth
                label="Accept"
                leadingIcon={<SfIcon name="hand.thumbsup.fill" size={14} color={ON_DARK} />}
                onPress={() => {
                  if (didRespond) return;
                  setDidRespond(true);
                  onAccept();
                }}
              />
            </View>
          </View>
        </View>
        <Pressable style={styles.dismissArea} onPress={onDismiss} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.popupSurface,
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  dismissArea: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: -1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarWrap: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: Colors.featureAccent,
  },
  headerText: { flex: 1, gap: 6 },
  headerName: { color: Colors.text1, fontSize: 17, fontWeight: '600' },
  headerTitle: { color: Colors.featureAccent, fontSize: 12 },
  headerCompany: { color: Colors.text2, fontSize: 11 },
  body: { color: Colors.text2, fontSize: 15, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
