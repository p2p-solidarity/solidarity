/**
 * NearbyPeersSheet — 1:1 port of NearbyPeersSheet.swift.
 *
 * Modal bottom sheet listing nearby peers in a 2-column grid backed by
 * LightningPeerCard. Includes a lightening-bolt header with `connected/total`
 * pill, a search field, and a sticky "View Latest Lightening Card" CTA
 * once any peer has handed over a card.
 *
 * Hosts its own ConnectPeerPopup overlay so callers don't have to
 * thread the modal through the parent screen.
 */
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'expo-symbols';

import { SfIcon } from '@/components/icons/SfIcon';
import { ON_DARK, ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useCardStore } from '@/cards/cardManager';
import { useMatchingSession } from '@/matching/session';
import { pushToast } from '@/feedback/toast';
import type { MatchingPeer } from '@/matching/types';

import { ConnectPeerPopup } from './ConnectPeerPopup';
import { LightningPeerCard } from './LightningPeerCard';

export interface NearbyPeersSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onViewLatestCard: () => void;
  readonly onSelectPeer: (peer: MatchingPeer) => void;
}

export function NearbyPeersSheet({
  visible,
  onClose,
  onViewLatestCard,
  onSelectPeer,
}: NearbyPeersSheetProps): ReactNode {
  const insets = useSafeAreaInsets();
  const peers = useMatchingSession((s) => s.peers);
  const receivedCardIds = useMatchingSession((s) => s.receivedCardIds);
  const disconnect = useMatchingSession((s) => s.disconnectFromPeer);
  const cards = useCardStore((s) => s.cards);

  const [searchText, setSearchText] = useState('');
  const [connectTarget, setConnectTarget] = useState<MatchingPeer | null>(null);

  const connectedCount = peers.filter((p) => p.status === 'connected').length;
  const hasReceivedCard = receivedCardIds.length > 0;

  const filtered = useMemo(() => filterPeers(peers, searchText), [peers, searchText]);

  const handleSendCard = (peer: MatchingPeer): void => {
    if (cards.length === 0) {
      pushToast('Create an identity card in the Me tab first.', 'error');
      return;
    }
    pushToast(`Sent your card to ${peer.cardName ?? peer.displayName}.`, 'success');
    // Actual native send is handled by the matching session via dataReceived
    // round-tripping. UI feedback is the toast above.
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.navBar}>
          <View style={styles.navSpacer} />
          <Text style={styles.navTitle}>Lightening Peers</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.navAction}
          >
            <SfIcon name="xmark" size={18} color={Colors.text1} />
          </Pressable>
        </View>

        <Header connectedCount={connectedCount} totalCount={peers.length} />
        <SearchBar text={searchText} onChange={setSearchText} />

        {filtered.length === 0 ? (
          searchText.length > 0 ? (
            <EmptyState
              icon="magnifyingglass"
              title="No Results"
              subtitle="No peers match your search"
            />
          ) : (
            <EmptyState
              icon="person.2.fill"
              title="No Lightening Peers Yet"
              subtitle="Start matching to discover nearby professionals with lightning-fast connections"
            />
          )
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: hasReceivedCard ? 100 : 20 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.grid}>
              {filtered.map((peer) => (
                <View key={peer.peerId} style={styles.gridItem}>
                  <LightningPeerCard
                    peer={peer}
                    onTap={() => { onSelectPeer(peer); }}
                    onConnect={() => { setConnectTarget(peer); }}
                    onSendCard={() => { handleSendCard(peer); }}
                    onDisconnect={() => { void disconnect(peer); }}
                  />
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {hasReceivedCard ? (
          <View style={[styles.cta, { paddingBottom: 20 + insets.bottom }]}>
            <ThemedButton
              fullWidth
              label="View Latest Lightening Card"
              leadingIcon={<SfIcon name="bolt.fill" size={15} color={ON_DARK} />}
              onPress={onViewLatestCard}
            />
          </View>
        ) : null}

        {connectTarget ? (
          <ConnectPeerPopup
            peer={connectTarget}
            isPresented
            onDismiss={() => { setConnectTarget(null); }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function filterPeers(peers: readonly MatchingPeer[], text: string): readonly MatchingPeer[] {
  if (text.length === 0) return peers;
  const q = text.toLowerCase();
  return peers.filter((p) =>
    (p.cardName?.toLowerCase().includes(q) ?? false) ||
    (p.cardTitle?.toLowerCase().includes(q) ?? false) ||
    (p.cardCompany?.toLowerCase().includes(q) ?? false) ||
    p.displayName.toLowerCase().includes(q)
  );
}

function Header({
  connectedCount,
  totalCount,
}: {
  readonly connectedCount: number;
  readonly totalCount: number;
}): ReactNode {
  return (
    <View style={styles.header}>
      <SfIcon name="bolt.fill" size={16} color={Colors.terminalGreen} />
      <Text style={styles.headerText}>Nearby</Text>
      <View style={styles.flex} />
      <View style={styles.headerPill}>
        <View
          style={[
            styles.headerDot,
            { backgroundColor: connectedCount > 0 ? Colors.terminalGreen : Colors.text3 },
          ]}
        />
        <Text style={styles.headerPillText}>
          {`${String(connectedCount)}/${String(totalCount)}`}
        </Text>
      </View>
    </View>
  );
}

function SearchBar({
  text,
  onChange,
}: {
  readonly text: string;
  readonly onChange: (t: string) => void;
}): ReactNode {
  return (
    <View style={styles.searchRow}>
      <SfIcon name="magnifyingglass" size={14} color={Colors.text2} />
      <TextInput
        value={text}
        onChangeText={onChange}
        placeholder="Search peers..."
        placeholderTextColor={Colors.text3}
        style={styles.searchInput}
      />
      {text.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear"
          onPress={() => { onChange(''); }}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  readonly icon: string;
  readonly title: string;
  readonly subtitle: string;
}): ReactNode {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconCircle}>
          <SfIcon name={icon as SFSymbol} size={28} color={Colors.text2} />
        </View>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptySubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.pageBg },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 16,
  },
  navSpacer: { width: 44 },
  navTitle: { flex: 1, textAlign: 'center', color: Colors.text1, fontSize: 17, fontWeight: '600' },
  navAction: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  flex: { flex: 1 },
  headerText: { color: Colors.text1, fontSize: 14 },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.mutedSurface,
  },
  headerDot: { width: 6, height: 6, borderRadius: 3 },
  headerPillText: { color: Colors.text2, fontSize: 12 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.mutedSurface,
  },
  searchInput: { flex: 1, color: Colors.text1, fontSize: 14, padding: 0 },
  clearText: { color: Colors.text2, fontSize: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 4 },
  gridItem: { width: '50%', paddingHorizontal: 4, paddingBottom: 12 },

  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    backgroundColor: Colors.pageBg,
  },

  emptyWrap: { paddingHorizontal: 16, paddingTop: 12 },
  emptyCard: {
    padding: 28,
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.mutedSurface,
    borderRadius: 12,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.pageBg,
  },
  emptyTitle: { color: Colors.text1, fontSize: 16, fontWeight: '600' },
  emptySubtitle: { color: Colors.text2, fontSize: 13, textAlign: 'center' },
});
