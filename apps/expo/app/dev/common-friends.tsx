/**
 * Common Friends Lab — pure DAG diff, no PSI. Per docs §3.5.
 *
 * Algorithm: after a P2P sync, both devices share a merged DAG that
 * holds exchange nodes from both authors. Common friends = peer_dids
 * that appear in exchange nodes authored by BOTH me AND the other
 * device. Trivial set intersection; no Diffie-Hellman PSI required.
 *
 * Privacy: sync transmits only nodes the requester asked for by id.
 * The HEAD set leaks a node count but not content. Materially stronger
 * than the Swift `SocialGraphIntersectionService.swift:31-36` hash-of-
 * `(name + nonce)` approach, which leaks ordering and is dictionary-
 * attackable on low-entropy names.
 *
 * Demo path: real two-device sync drops the other author's nodes into
 * our store. For sandbox single-phone testing, "Seed mock peer +
 * shared friends" generates an ephemeral peer identity and signs a
 * canonical fixture with an intentional overlap so the intersection
 * algorithm has something concrete to compute.
 */
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { schnorr } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';

import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { loadOrCreateDevKey } from '@/dag/devKey';
import { getDagStore } from '@/dag/instance';
import {
  KIND_DAG_NODE,
  type DagNode,
  type DagNodeUnsigned,
  hexEncode,
  signNode,
} from '@/dag/node';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { usePreferences } from '@/settings/preferences';

const MOCK_PEER_FIXTURE = {
  /** peer_dids the mock peer has exchanged with — overlap with FIXTURE_MINE drives the intersection. */
  theirs: [
    'did:key:zCommonAlice',
    'did:key:zCommonBob',
    'did:key:zCommonCarol',
    'did:key:zOnlyTheirs1',
    'did:key:zOnlyTheirs2',
  ] as const,
  mine: [
    'did:key:zCommonAlice',
    'did:key:zCommonBob',
    'did:key:zCommonCarol',
    'did:key:zOnlyMine1',
    'did:key:zOnlyMine2',
  ] as const,
};

interface AuthorBucket {
  readonly author: string;
  readonly exchangeCount: number;
  /** Earliest exchange ts per peer_did. */
  readonly byPeerDid: ReadonlyMap<string, DagNode>;
}

interface CommonRow {
  readonly peerDid: string;
  readonly myEarliest: number;
  readonly theirEarliest: number;
  readonly sharedEvents: number;
}

function bucketByAuthor(nodes: readonly DagNode[]): ReadonlyMap<string, AuthorBucket> {
  const acc = new Map<string, Map<string, DagNode>>();
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.action !== 'exchange') continue;
    const peerDid = n.payload['peer_did'];
    if (typeof peerDid !== 'string') continue;
    let inner = acc.get(n.author);
    if (!inner) {
      inner = new Map();
      acc.set(n.author, inner);
    }
    const existing = inner.get(peerDid);
    if (!existing || n.created_at < existing.created_at) {
      inner.set(peerDid, n);
    }
    counts.set(n.author, (counts.get(n.author) ?? 0) + 1);
  }
  const out = new Map<string, AuthorBucket>();
  for (const [author, byPeerDid] of acc) {
    out.set(author, {
      author,
      exchangeCount: counts.get(author) ?? 0,
      byPeerDid,
    });
  }
  return out;
}

function intersect(mine: AuthorBucket, theirs: AuthorBucket): readonly CommonRow[] {
  const rows: CommonRow[] = [];
  for (const [peerDid, myNode] of mine.byPeerDid) {
    const theirNode = theirs.byPeerDid.get(peerDid);
    if (!theirNode) continue;
    rows.push({
      peerDid,
      myEarliest: myNode.created_at,
      theirEarliest: theirNode.created_at,
      sharedEvents: 2, // simple count: my earliest + their earliest. Multi-event count would walk all exchange nodes.
    });
  }
  rows.sort((a, b) => a.myEarliest - b.myEarliest);
  return rows;
}

export default function CommonFriendsLab() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const [devPubkey, setDevPubkey] = useState<string>('');
  const [nodes, setNodes] = useState<readonly DagNode[]>([]);
  const [selectedOther, setSelectedOther] = useState<string | null>(null);

  const refresh = useCallback(() => {
    try {
      setNodes(getDagStore().allNodes());
    } catch {
      setNodes([]);
    }
  }, []);

  useEffect(() => {
    if (!developerMode) return;
    try {
      setDevPubkey(loadOrCreateDevKey().pubkeyHex);
    } catch {
      setDevPubkey('');
    }
    refresh();
  }, [developerMode, refresh]);

  const buckets = useMemo(() => bucketByAuthor(nodes), [nodes]);
  const me = devPubkey ? buckets.get(devPubkey) : undefined;
  const otherAuthors = useMemo(() => {
    const out: AuthorBucket[] = [];
    for (const [author, bucket] of buckets) {
      if (author !== devPubkey) out.push(bucket);
    }
    out.sort((a, b) => b.exchangeCount - a.exchangeCount);
    return out;
  }, [buckets, devPubkey]);

  const selectedBucket = selectedOther ? buckets.get(selectedOther) : null;
  const commonRows = useMemo(() => {
    if (!me || !selectedBucket) return [];
    return intersect(me, selectedBucket);
  }, [me, selectedBucket]);

  const seedDemo = useCallback(() => {
    try {
      const myKey = loadOrCreateDevKey();
      const store = getDagStore();
      const baseTs = Math.floor(Date.now() / 1000);
      let insertedMine = 0;
      MOCK_PEER_FIXTURE.mine.forEach((peerDid, i) => {
        const unsigned: DagNodeUnsigned = {
          author: myKey.pubkeyHex,
          parents: store.heads(),
          kind: KIND_DAG_NODE,
          action: 'exchange',
          payload: { peer_did: peerDid, note: 'sandbox demo' },
          created_at: baseTs + i,
        };
        const node = signNode(unsigned, myKey.privkey);
        if (store.appendNode(node).kind === 'inserted') insertedMine++;
      });
      // Mock peer ephemeral identity — privkey discarded after signing.
      const mockPriv = generateSchnorrPrivkey();
      const mockPub = hexEncode(schnorr.getPublicKey(mockPriv));
      let insertedTheirs = 0;
      MOCK_PEER_FIXTURE.theirs.forEach((peerDid, i) => {
        const unsigned: DagNodeUnsigned = {
          author: mockPub,
          parents: store.heads(),
          kind: KIND_DAG_NODE,
          action: 'exchange',
          payload: { peer_did: peerDid, note: 'mock peer fixture' },
          created_at: baseTs + 100 + i,
        };
        const node = signNode(unsigned, mockPriv);
        if (store.appendNode(node).kind === 'inserted') insertedTheirs++;
      });
      pushToast(
        `Seeded · me +${String(insertedMine)} · mock peer +${String(insertedTheirs)} · mock pubkey ${mockPub.slice(0, 12)}…`,
        'success',
        3500
      );
      haptic('success');
      setSelectedOther(mockPub);
      refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Seed failed', 'error', 3000);
      haptic('error');
    }
  }, [refresh]);

  const clearOthersOnly = useCallback(() => {
    Alert.alert(
      'Clear all DAG nodes?',
      'Common Friends shares the same DAG store as other Labs. Clearing here wipes everything (your nodes too). Use DAG Lab "Clear all" if you want explicit control.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: () => {
            try {
              getDagStore().clear();
              setSelectedOther(null);
              refresh();
              pushToast('DAG cleared', 'success', 2000);
            } catch (err) {
              pushToast(err instanceof Error ? err.message : 'Clear failed', 'error', 3000);
            }
          },
        },
      ]
    );
  }, [refresh]);

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={{ presentation: 'modal' }} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title="Common Friends" />
        <View className="px-4 pt-6">
          <Text className="text-text2 text-[13px]">
            Sandbox is gated by Developer Mode. Toggle it in Settings ▸ Developer first.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Common Friends" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              Common friends = peer_dids that appear in exchange nodes authored by BOTH me and another device. Pure DAG diff, no PSI cryptography needed (docs §3.5).
            </Text>
            <Text className="text-text3 text-[12px]" style={{ marginTop: 8 }}>
              {`This store currently holds ${String(nodes.length)} node${nodes.length === 1 ? '' : 's'} from ${String(buckets.size)} author${buckets.size === 1 ? '' : 's'}.`}
            </Text>
          </View>

          <SettingsBlockSection
            title="Demo"
            footer="Generates an ephemeral peer identity, signs a fixture with 3 overlapping peer_dids (Alice/Bob/Carol) and 2 distinct, then appends to the shared store. The mock peer's privkey is discarded after signing — sigs verify because the pubkey is in each node."
          >
            <SettingsBlockRow
              icon="person.crop.circle.badge.plus"
              title="Seed mock peer + shared friends"
              onPress={seedDemo}
            />
            <SettingsBlockRow
              icon="trash"
              title="Clear DAG store"
              onPress={clearOthersOnly}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`My exchange nodes (${String(me?.exchangeCount ?? 0)}) · ${String(me?.byPeerDid.size ?? 0)} unique peer_did${(me?.byPeerDid.size ?? 0) === 1 ? '' : 's'}`}
              </Text>
            </View>
            <View className="px-4">
              <View
                className="bg-mutedSurface rounded-xl"
                style={{ paddingHorizontal: 14, paddingVertical: 12 }}
              >
                {!me || me.byPeerDid.size === 0 ? (
                  <Text className="text-text2 text-[13px]">
                    No exchange nodes from me yet. Use Demo above or DAG Lab to add one.
                  </Text>
                ) : (
                  Array.from(me.byPeerDid.keys()).slice(0, 12).map((peerDid) => (
                    <Text
                      key={peerDid}
                      className="text-text1 text-[12px]"
                      style={{ fontFamily: 'Menlo' }}
                      numberOfLines={1}
                    >
                      {peerDid}
                    </Text>
                  ))
                )}
              </View>
            </View>
          </View>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`Other authors (${String(otherAuthors.length)})`}
              </Text>
            </View>
            <View className="px-4 gap-2">
              {otherAuthors.length === 0 ? (
                <View
                  className="bg-mutedSurface rounded-xl"
                  style={{ paddingHorizontal: 14, paddingVertical: 14 }}
                >
                  <Text className="text-text2 text-[13px]">
                    No other authors in the DAG yet — sync with a peer (P2P Lab) or seed the demo.
                  </Text>
                </View>
              ) : (
                otherAuthors.map((bucket) => (
                  <SettingsBlockRow
                    key={bucket.author}
                    icon="person.crop.circle"
                    title={`${bucket.author.slice(0, 14)}… (${String(bucket.exchangeCount)} exch)`}
                    subtitle={
                      selectedOther === bucket.author
                        ? 'Selected — intersection below'
                        : 'Tap to compute intersection'
                    }
                    onPress={() => { setSelectedOther(bucket.author); }}
                  />
                ))
              )}
            </View>
          </View>

          {selectedBucket ? (
            <View className="gap-3">
              <View className="px-4">
                <Text className="text-text1 text-[14px]">
                  {`Intersection · ${String(commonRows.length)} shared friend${commonRows.length === 1 ? '' : 's'}`}
                </Text>
              </View>
              <View className="px-4 gap-2">
                {commonRows.length === 0 ? (
                  <View
                    className="bg-mutedSurface rounded-xl"
                    style={{ paddingHorizontal: 14, paddingVertical: 14 }}
                  >
                    <Text className="text-text2 text-[13px]">
                      No peer_did appears in exchange nodes from both me and{' '}
                      {selectedBucket.author.slice(0, 14)}….
                    </Text>
                  </View>
                ) : (
                  commonRows.map((row) => (
                    <View
                      key={row.peerDid}
                      className="bg-mutedSurface rounded-xl"
                      style={{ paddingHorizontal: 14, paddingVertical: 12 }}
                    >
                      <Text
                        className="text-text1 text-[13px] font-semibold"
                        style={{ fontFamily: 'Menlo' }}
                        numberOfLines={1}
                      >
                        {row.peerDid}
                      </Text>
                      <Text
                        className="text-text3 text-[11px]"
                        style={{ marginTop: 4 }}
                      >
                        {`I first met: ${new Date(row.myEarliest * 1000).toISOString().slice(0, 19).replace('T', ' ')}`}
                      </Text>
                      <Text className="text-text3 text-[11px]">
                        {`They first met: ${new Date(row.theirEarliest * 1000).toISOString().slice(0, 19).replace('T', ' ')}`}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          ) : null}

          <View className="px-4 pt-2">
            <Text
              className="text-text3 text-[12px]"
              style={{ color: Colors.text3 }}
            >
              Replaces Swift `SocialGraphIntersectionService` hash-of-name PSI which leaks ordering. DAG diff doesn't reveal anything the peer can't already learn by walking the merged DAG locally.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function generateSchnorrPrivkey(): Uint8Array {
  // schnorr requires (0, n) — almost always satisfied by randomBytes(32).
  // Same rejection-sample pattern as src/dag/devKey.ts.
  for (let attempt = 0; attempt < 10; attempt++) {
    const k = randomBytes(32);
    try {
      schnorr.getPublicKey(k);
      return k;
    } catch {
      // Invalid scalar — retry.
    }
  }
  throw new Error('Failed to generate valid schnorr key for mock peer');
}
