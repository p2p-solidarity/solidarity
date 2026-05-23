/**
 * LightningPeerCard — 1:1 port of LightningPeerCard.swift.
 *
 * Status-aware peer cell with three footer modes:
 *   disconnected → Connect pill (primaryBlue capsule)
 *   connecting   → Connecting pill (warning capsule, spinner)
 *   connected    → Send pill (terminalGreen) + disconnect circle button
 *
 * Mirrors the SwiftUI 12-pt rounded mutedSurface container with a
 * 1pt featureAccent border when status is `connected`.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

import { PeerAvatar } from './PeerAvatar';
import type { MatchingPeer, PeerStatus, VerificationStatus } from '@/matching/types';

export interface LightningPeerCardProps {
  readonly peer: MatchingPeer;
  readonly onTap: () => void;
  readonly onConnect?: () => void;
  readonly onSendCard?: () => void;
  readonly onDisconnect?: () => void;
}

const STATUS_COLOR: Readonly<Record<PeerStatus, string>> = {
  connected: Colors.terminalGreen,
  connecting: Colors.warning,
  disconnected: Colors.text3,
};

const VERIFICATION_COLOR: Readonly<Record<VerificationStatus, string>> = {
  verified: Colors.terminalGreen,
  pending: Colors.warning,
  unverified: Colors.primaryBlue,
  failed: Colors.destructive,
};

const STATUS_LABEL: Readonly<Record<PeerStatus, string>> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
};

const VERIFICATION_LABEL: Readonly<Record<VerificationStatus, string>> = {
  verified: 'Verified',
  pending: 'Pending',
  unverified: 'Unverified',
  failed: 'Failed',
};

export function LightningPeerCard({
  peer,
  onTap,
  onConnect,
  onSendCard,
  onDisconnect,
}: LightningPeerCardProps): ReactNode {
  const statusColor = STATUS_COLOR[peer.status];
  const isConnected = peer.status === 'connected';
  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onTap();
      }}
      accessibilityRole="button"
      accessibilityLabel={peer.cardName ?? peer.displayName}
      style={({ pressed }) => [
        styles.card,
        isConnected ? styles.cardConnected : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={styles.header}>
        <PeerAvatar animal={peer.cardAnimal} size={50} ringColor={statusColor} />
        <View style={styles.statusBlock}>
          <View style={styles.statusRow}>
            {peer.status === 'connecting' ? (
              <ActivityIndicator color={statusColor} size="small" style={styles.statusDot} />
            ) : (
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            )}
            <Text style={styles.statusText}>{STATUS_LABEL[peer.status]}</Text>
          </View>
          {peer.verification ? (
            <VerificationLine status={peer.verification} />
          ) : peer.zkReady ? (
            <View style={styles.statusRow}>
              <SfIcon name="shield.checkerboard" size={12} color={Colors.primaryBlue} />
              <Text style={styles.zkText}>ZK Ready</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.info}>
        <Text numberOfLines={1} style={styles.name}>
          {peer.cardName ?? peer.displayName}
        </Text>
        {peer.cardTitle ? (
          <Text numberOfLines={1} style={styles.title}>
            {peer.cardTitle}
          </Text>
        ) : null}
        {peer.cardCompany ? (
          <Text numberOfLines={1} style={styles.company}>
            {peer.cardCompany}
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        {peer.status === 'disconnected' ? (
          <ConnectPill onPress={onConnect} />
        ) : peer.status === 'connecting' ? (
          <ConnectingPill />
        ) : (
          <>
            {onSendCard ? <SendCardPill onPress={onSendCard} /> : null}
            {onDisconnect ? <DisconnectButton onPress={onDisconnect} /> : null}
          </>
        )}
        <View style={styles.flex} />
        <SfIcon
          name="bolt.fill"
          size={12}
          color={isConnected ? Colors.terminalGreen : Colors.text3}
        />
      </View>
    </Pressable>
  );
}

function VerificationLine({ status }: { readonly status: VerificationStatus }): ReactNode {
  return (
    <View style={styles.statusRow}>
      <SfIcon name="checkmark.seal.fill" size={12} color={VERIFICATION_COLOR[status]} />
      <Text style={styles.zkText}>{VERIFICATION_LABEL[status]}</Text>
    </View>
  );
}

function ConnectPill({ onPress }: { readonly onPress?: () => void }): ReactNode {
  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel="Connect"
      style={[styles.pill, { backgroundColor: Colors.primaryBlue }]}
    >
      <SfIcon name="link.badge.plus" size={12} color="#FFFFFF" />
      <Text style={styles.pillText}>Connect</Text>
    </Pressable>
  );
}

function ConnectingPill(): ReactNode {
  return (
    <View style={[styles.pill, { backgroundColor: Colors.warning }]}>
      <ActivityIndicator color="#FFFFFF" size="small" />
      <Text style={styles.pillText}>Connecting…</Text>
    </View>
  );
}

function SendCardPill({ onPress }: { readonly onPress: () => void }): ReactNode {
  return (
    <Pressable
      onPress={() => {
        haptic('success');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="Send card"
      style={[styles.pill, { backgroundColor: Colors.terminalGreen }]}
    >
      <SfIcon name="paperplane.fill" size={12} color="#FFFFFF" />
      <Text style={styles.pillText}>Send</Text>
    </Pressable>
  );
}

function DisconnectButton({ onPress }: { readonly onPress: () => void }): ReactNode {
  return (
    <Pressable
      onPress={() => {
        haptic('warning');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="Disconnect"
      style={styles.disconnect}
    >
      <SfIcon name="xmark.circle.fill" size={14} color={Colors.text2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.mutedSurface,
    gap: 12,
  },
  cardConnected: {
    borderWidth: 1,
    borderColor: `${Colors.featureAccent}66`,
  },
  cardPressed: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center' },
  statusBlock: { flex: 1, alignItems: 'flex-end', gap: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: Colors.text1, fontSize: 12 },
  zkText: { color: Colors.text2, fontSize: 12 },
  info: { gap: 4 },
  name: { color: Colors.text1, fontSize: 16, fontWeight: '600' },
  title: { color: Colors.featureAccent, fontSize: 12 },
  company: { color: Colors.text2, fontSize: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  disconnect: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: Colors.searchBg,
  },
  flex: { flex: 1 },
});
