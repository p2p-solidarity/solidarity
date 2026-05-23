/**
 * ConnectPeerPopup — 1:1 port of ConnectPeerPopupView.swift.
 *
 * Modal that drives the lightning-card flow: idle → connecting → connected
 * → exchanging → success (or error). Auto-starts the invite when opened
 * from a deliberate Connect tap (`autoStartConnect`) and auto-sends our
 * card when the MultipeerConnectivity session reaches `connected`
 * (`autoExchangeOnConnect`).
 *
 * The 25s timeout matches Swift (`connectTimeoutSeconds`) — MultipeerConnectivity's
 * `invitePeer` has a 30s internal timeout and we fail the popup a few
 * seconds earlier so the user gets feedback instead of an indefinite spinner.
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { SFSymbol } from 'expo-symbols';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useMatchingSession } from '@/matching/session';
import type { MatchingPeer, PeerStatus } from '@/matching/types';

import { PeerAvatar } from './PeerAvatar';

const CONNECT_TIMEOUT_MS = 25_000;
const EXCHANGE_HOLD_MS = 600;
const SUCCESS_DISMISS_MS = 1000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'exchanging' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export interface ConnectPeerPopupProps {
  readonly peer: MatchingPeer;
  readonly isPresented: boolean;
  readonly autoDismissOnSuccess?: boolean;
  readonly autoStartConnect?: boolean;
  readonly autoExchangeOnConnect?: boolean;
  readonly onDismiss: () => void;
}

export function ConnectPeerPopup({
  peer,
  isPresented,
  autoDismissOnSuccess = true,
  autoStartConnect = true,
  autoExchangeOnConnect = true,
  onDismiss,
}: ConnectPeerPopupProps): ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exchangeRef = useRef(false);

  const livePeer = useMatchingSession((s) =>
    s.peers.find((p) => p.peerId === peer.peerId) ?? peer
  );
  const sessionConnect = useMatchingSession((s) => s.connectToPeer);
  const sessionCancel = useMatchingSession((s) => s.cancelConnectionAttempt);
  const lastError = useMatchingSession((s) => s.lastErrorMessage);
  const clearError = useMatchingSession((s) => s.clearError);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    onDismiss();
  }, [clearTimer, onDismiss]);

  const startConnect = useCallback(() => {
    exchangeRef.current = false;
    setPhase({ kind: 'connecting' });
    clearError();
    void sessionConnect(peer);
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      setPhase((p) => {
        if (p.kind !== 'connecting') return p;
        void sessionCancel(peer);
        return {
          kind: 'error',
          message: "Peer didn't respond in time. They may have closed the app or declined.",
        };
      });
    }, CONNECT_TIMEOUT_MS);
  }, [clearError, clearTimer, peer, sessionCancel, sessionConnect]);

  const triggerExchange = useCallback(
    (force = false) => {
      if (!force && (!autoExchangeOnConnect || exchangeRef.current)) return;
      exchangeRef.current = true;
      setPhase({ kind: 'exchanging' });
      setTimeout(() => {
        setPhase((p) => (p.kind === 'exchanging' ? { kind: 'success' } : p));
        if (autoDismissOnSuccess) {
          setTimeout(() => { dismiss(); }, SUCCESS_DISMISS_MS);
        }
      }, EXCHANGE_HOLD_MS);
    },
    [autoDismissOnSuccess, autoExchangeOnConnect, dismiss]
  );

  // Wire-up on mount / open.
  useEffect(() => {
    if (!isPresented) return;
    if (livePeer.status === 'connecting' && phase.kind === 'idle') {
      setPhase({ kind: 'connecting' });
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        setPhase((p) => {
          if (p.kind !== 'connecting') return p;
          void sessionCancel(peer);
          return { kind: 'error', message: 'Connection timed out.' };
        });
      }, CONNECT_TIMEOUT_MS);
    } else if (livePeer.status === 'connected' && phase.kind === 'idle') {
      setPhase({ kind: 'connected' });
      triggerExchange();
    } else if (autoStartConnect && livePeer.status === 'disconnected' && phase.kind === 'idle') {
      startConnect();
    }
    return clearTimer;
    // Mount-only effect that mirrors Swift onAppear — deps stay minimal
    // on purpose. Adding `phase` or `livePeer.status` would re-fire the
    // popup-onboarding logic each render, causing a duplicate invite.
  }, [isPresented, peer.peerId, autoStartConnect, clearTimer, livePeer.status, phase.kind, sessionCancel, startConnect, triggerExchange, peer]);

  // React to live status changes — matches Swift onChange(nearbyPeers).
  useEffect(() => {
    if (!isPresented) return;
    if (livePeer.status === 'connected' && phase.kind === 'connecting') {
      clearTimer();
      setPhase({ kind: 'connected' });
      if (autoExchangeOnConnect) {
        // Defer one tick so transition lands before the exchange fires.
        setTimeout(triggerExchange, 0);
      }
    } else if (
      livePeer.status === 'disconnected' &&
      phase.kind === 'connecting'
    ) {
      clearTimer();
      setPhase({
        kind: 'error',
        message: 'Peer disconnected before accepting. Please try again.',
      });
    }
  }, [autoExchangeOnConnect, clearTimer, isPresented, livePeer.status, phase.kind, triggerExchange]);

  // Surface manager-level errors.
  useEffect(() => {
    if (!lastError || phase.kind === 'success') return;
    setPhase({ kind: 'error', message: lastError });
  }, [lastError, phase.kind]);

  const canTapOutside = phase.kind !== 'connecting' && phase.kind !== 'exchanging';

  return (
    <Modal
      visible={isPresented}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (canTapOutside) dismiss();
      }}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          if (canTapOutside) dismiss();
        }}
      >
        <Pressable
          // Stop tap bubbling so taps inside don't dismiss the modal.
          onPress={() => { /* swallow */ }}
          style={styles.card}
        >
          <PeerHeader peer={livePeer} highlight={livePeer.status === 'connected'} />
          <PhaseStatus phase={phase} autoExchangeOnConnect={autoExchangeOnConnect} />
          <PhaseActions
            phase={phase}
            autoExchangeOnConnect={autoExchangeOnConnect}
            onCancel={() => {
              clearTimer();
              void sessionCancel(peer);
              dismiss();
            }}
            onConnect={startConnect}
            onSendCard={() => triggerExchange(true)}
            onDismiss={dismiss}
            onRetry={startConnect}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PeerHeader({
  peer,
  highlight,
}: {
  readonly peer: MatchingPeer;
  readonly highlight: boolean;
}): ReactNode {
  const statusColor = peer.status === 'connected'
    ? Colors.terminalGreen
    : peer.status === 'connecting'
      ? Colors.warning
      : Colors.text3;
  return (
    <View style={styles.headerRow}>
      <PeerAvatar
        animal={peer.cardAnimal}
        size={54}
        ringColor={statusColor}
        outerRingColor={highlight ? Colors.featureAccent : undefined}
      />
      <View style={styles.headerText}>
        <Text style={styles.headerName} numberOfLines={1}>
          {peer.cardName ?? peer.displayName}
        </Text>
        {peer.cardTitle ? (
          <Text style={styles.headerTitle} numberOfLines={1}>
            {peer.cardTitle}
          </Text>
        ) : null}
        {peer.cardCompany ? (
          <Text style={styles.headerCompany} numberOfLines={1}>
            {peer.cardCompany}
          </Text>
        ) : null}
      </View>
      <SfIcon name={iconForStatus(peer.status)} size={18} color={statusColor} />
    </View>
  );
}

function iconForStatus(status: PeerStatus): SFSymbol {
  if (status === 'connected') return 'circle.fill';
  if (status === 'connecting') return 'circle.dotted';
  return 'circle';
}

function PhaseStatus({
  phase,
  autoExchangeOnConnect,
}: {
  readonly phase: Phase;
  readonly autoExchangeOnConnect: boolean;
}): ReactNode {
  if (phase.kind === 'idle') {
    return (
      <Text style={styles.subtitleCenter}>
        Connect to this peer to exchange cards fast.
      </Text>
    );
  }
  if (phase.kind === 'connecting') {
    return (
      <View style={styles.statusBlock}>
        <View style={styles.statusRow}>
          <ActivityIndicator color={Colors.featureAccent} />
          <Text style={styles.subtitle}>Waiting for peer to accept…</Text>
        </View>
        <Text style={styles.captionTertiary}>They need to confirm on their device.</Text>
      </View>
    );
  }
  if (phase.kind === 'connected') {
    return (
      <View style={styles.statusRow}>
        <SfIcon name="link.circle.fill" size={18} color={Colors.terminalGreen} />
        <Text style={styles.subtitle}>Connected</Text>
      </View>
    );
  }
  if (phase.kind === 'exchanging') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator color={Colors.featureAccent} />
        <Text style={styles.subtitle}>Sending card…</Text>
      </View>
    );
  }
  if (phase.kind === 'success') {
    return (
      <View style={styles.statusRow}>
        <SfIcon name="checkmark.seal.fill" size={18} color={Colors.terminalGreen} />
        <Text style={styles.subtitle}>{autoExchangeOnConnect ? 'Card sent!' : 'Connected!'}</Text>
      </View>
    );
  }
  return (
    <View style={styles.statusBlock}>
      <View style={styles.statusRow}>
        <SfIcon name="exclamationmark.triangle.fill" size={18} color={Colors.warning} />
        <Text style={styles.subtitleStrong}>Connection failed</Text>
      </View>
      <Text style={styles.captionCenter}>{phase.message}</Text>
    </View>
  );
}

interface ActionProps {
  readonly phase: Phase;
  readonly autoExchangeOnConnect: boolean;
  readonly onCancel: () => void;
  readonly onConnect: () => void;
  readonly onSendCard: () => void;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
}

function PhaseActions({
  phase,
  autoExchangeOnConnect,
  onCancel,
  onConnect,
  onSendCard,
  onDismiss,
  onRetry,
}: ActionProps): ReactNode {
  if (phase.kind === 'idle') {
    return (
      <View style={styles.actions}>
        <View style={styles.flex}>
          <ThemedButton fullWidth variant="secondary" label="Cancel" onPress={onCancel} />
        </View>
        <View style={styles.flex}>
          <ThemedButton
            fullWidth
            label="Connect"
            leadingIcon={<SfIcon name="link.badge.plus" size={14} color="#FFFFFF" />}
            onPress={onConnect}
          />
        </View>
      </View>
    );
  }
  if (phase.kind === 'connecting' || phase.kind === 'exchanging') {
    return (
      <ThemedButton
        fullWidth
        variant="secondary"
        label={phase.kind === 'connecting' ? 'Cancel' : 'Hide'}
        onPress={onCancel}
      />
    );
  }
  if (phase.kind === 'connected') {
    return (
      <View style={styles.actions}>
        <View style={styles.flex}>
          <ThemedButton fullWidth variant="secondary" label="Done" onPress={onDismiss} />
        </View>
        {autoExchangeOnConnect ? null : (
          <View style={styles.flex}>
            <ThemedButton
              fullWidth
              label="Send Card"
              leadingIcon={<SfIcon name="paperplane.fill" size={14} color="#FFFFFF" />}
              onPress={onSendCard}
            />
          </View>
        )}
      </View>
    );
  }
  if (phase.kind === 'success') {
    return <ThemedButton fullWidth label="Done" onPress={onDismiss} />;
  }
  return (
    <View style={styles.actions}>
      <View style={styles.flex}>
        <ThemedButton fullWidth variant="secondary" label="Close" onPress={onDismiss} />
      </View>
      <View style={styles.flex}>
        <ThemedButton fullWidth label="Try Again" onPress={onRetry} />
      </View>
    </View>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, gap: 6 },
  headerName: { color: Colors.text1, fontSize: 17, fontWeight: '600' },
  headerTitle: { color: Colors.featureAccent, fontSize: 12 },
  headerCompany: { color: Colors.text2, fontSize: 11 },
  subtitle: { color: Colors.text2, fontSize: 15 },
  subtitleCenter: { color: Colors.text2, fontSize: 15, textAlign: 'center' },
  subtitleStrong: { color: Colors.text1, fontSize: 15, fontWeight: '600' },
  statusBlock: { gap: 6, alignItems: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  captionTertiary: { color: Colors.text3, fontSize: 11 },
  captionCenter: { color: Colors.text2, fontSize: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
