/**
 * P2P Lab — DAG sync protocol + handshake QR + ICE config + transport
 * log, sandbox-only. The headline-capability Lab per docs §3.3.
 *
 * What's wired in this commit:
 *   - Dev key load (creates / loads sandbox secp256k1 from MMKV)
 *   - Local DAG store (in-memory + idempotent re-mount)
 *   - "Append test node" — signs a real `dev.test` node, persists
 *   - "Sync with mock peer" — drives three-step sync against an
 *     ephemeral peer store; transport log shows every frame
 *   - "Generate handshake QR" — real signed payload with the dev pubkey
 *   - ICE servers field (state-only per §13.1; webrtc.ts consumer
 *     lands in the next phase along with the real BLE/WebRTC wire)
 *
 * Deferred (TODOs marked inline below):
 *   - Real BLE-side wire integration (sendData hook into nitro-proximity)
 *   - Real WebRTC LAN-direct DataChannel (src/dag/webrtc.ts)
 *   - Scan-peer-handshake camera flow
 *
 * Sandbox demo path stays useful without those — the protocol logic
 * is exercised by the mock peer round, which uses the exact same
 * `runSyncStep` the production transport will call.
 */
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { KIND_DAG_NODE, signNode, type DagNodeUnsigned } from '@/dag/node';
import { loadOrCreateDevKey, resetDevKey } from '@/dag/devKey';
import { getDagStore } from '@/dag/instance';
import { InMemoryDagBackend, createDagStore, type DagStore } from '@/dag/store';
import {
  buildHeadsFrame,
  runSyncStep,
} from '@/dag/sync';
import { smokeTestPair, type SmokeTestResult } from '@/dag/webrtc';
import {
  FRAME_KIND_HEADS,
  FRAME_KIND_NODE,
  FRAME_KIND_WANT,
  drainDagFrames,
  type DagFrameKind,
} from '@/dag/wire';
import { usePreferences } from '@/settings/preferences';

const LOG_MAX = 60;

interface TransportLogEntry {
  readonly ts: number;
  readonly direction: 'tx' | 'rx';
  readonly side: 'me' | 'peer';
  readonly frameKind: DagFrameKind;
  readonly note: string;
}

function frameLabel(kind: DagFrameKind): string {
  if (kind === FRAME_KIND_HEADS) return 'HEADS';
  if (kind === FRAME_KIND_WANT) return 'WANT';
  if (kind === FRAME_KIND_NODE) return 'NODE';
  return `0x${kind.toString(16).padStart(2, '0')}`;
}

interface HandshakePayload {
  readonly v: 1;
  readonly pubkey: string;
  readonly ice: readonly string[];
}

// Hoisted so the object identity is STABLE across renders — an inline
// `options={{ presentation: 'modal' }}` is a new object each render → expo-router
// re-runs setOptions every render → re-render loop → "Maximum update depth
// exceeded". See apps/expo/CLAUDE.md "Error handling".
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;

export default function P2PLab() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const [pubkeyHex, setPubkeyHex] = useState<string>('');
  const [keyReady, setKeyReady] = useState(false);
  const [iceServers, setIceServers] = useState('');
  const [myCount, setMyCount] = useState(0);
  const [peerCount, setPeerCount] = useState(0);
  const [myHeads, setMyHeads] = useState<readonly string[]>([]);
  const [peerHeads, setPeerHeads] = useState<readonly string[]>([]);
  const [logs, setLogs] = useState<readonly TransportLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [webrtcResult, setWebrtcResult] = useState<SmokeTestResult | null>(null);
  const [webrtcBusy, setWebrtcBusy] = useState(false);
  const myStoreRef = useRef<DagStore | null>(null);
  const peerStoreRef = useRef<DagStore | null>(null);
  const privkeyRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!developerMode) return;
    try {
      const { privkey, pubkeyHex: pk } = loadOrCreateDevKey();
      privkeyRef.current = privkey;
      setPubkeyHex(pk);
      setKeyReady(true);
    } catch (err) {
      setPubkeyHex(`error: ${err instanceof Error ? err.message : 'unknown'}`);
      setKeyReady(false);
    }
    // "Mine" is the persistent singleton — nodes appended here survive
    // restart and are visible to Identity Tree / DAG Lab / Nostr Bridge.
    // "Mock Peer" stays ephemeral so the sync demo always starts clean.
    myStoreRef.current = getDagStore();
    peerStoreRef.current = createDagStore(new InMemoryDagBackend());
    refreshSnapshots();
    return () => {
      myStoreRef.current = null;
      peerStoreRef.current = null;
      privkeyRef.current = null;
    };
  }, [developerMode]);

  const refreshSnapshots = useCallback(() => {
    const mine = myStoreRef.current;
    const peer = peerStoreRef.current;
    if (mine) {
      setMyCount(mine.count());
      setMyHeads(mine.heads());
    }
    if (peer) {
      setPeerCount(peer.count());
      setPeerHeads(peer.heads());
    }
  }, []);

  const logFrame = useCallback(
    (direction: 'tx' | 'rx', side: 'me' | 'peer', kind: DagFrameKind, note: string) => {
      setLogs((cur) =>
        [{ ts: Date.now(), direction, side, frameKind: kind, note }, ...cur].slice(0, LOG_MAX)
      );
    },
    []
  );

  const appendTestNode = useCallback((to: 'me' | 'peer') => {
    const store = to === 'me' ? myStoreRef.current : peerStoreRef.current;
    const privkey = privkeyRef.current;
    if (!store || !privkey) return;
    const parents = store.heads();
    const unsigned: DagNodeUnsigned = {
      author: pubkeyHex,
      parents,
      kind: KIND_DAG_NODE,
      action: 'dev.test',
      payload: { side: to, n: store.count() + 1 },
      created_at: Math.floor(Date.now() / 1000),
    };
    const node = signNode(unsigned, privkey);
    const r = store.appendNode(node);
    refreshSnapshots();
    logFrame('tx', to, FRAME_KIND_NODE, `appended ${node.id.slice(0, 12)}… (${r.kind})`);
  }, [pubkeyHex, refreshSnapshots, logFrame]);

  const runSyncRound = useCallback(async () => {
    const mine = myStoreRef.current;
    const peer = peerStoreRef.current;
    if (!mine || !peer || busy) return;
    setBusy(true);
    try {
      // Me → Peer: HEADS
      const myHeadsFrame = buildHeadsFrame(mine);
      logFrame('tx', 'me', FRAME_KIND_HEADS, `heads=${mine.heads().length}`);
      const { dag: peerInbound } = drainDagFrames(myHeadsFrame);
      for (const f of peerInbound) logFrame('rx', 'peer', f.kind, 'from me');
      const peerResp = runSyncStep(peer, peerInbound);
      for (const buf of peerResp.outboundFrames) {
        const { dag } = drainDagFrames(buf);
        for (const f of dag) logFrame('tx', 'peer', f.kind, `to me · ${f.body.length}B body`);
      }

      // Peer → Me: WANT (then NODE responses from me)
      const flatPeerBytes = concatBytes(peerResp.outboundFrames);
      const { dag: meInbound1 } = drainDagFrames(flatPeerBytes);
      for (const f of meInbound1) logFrame('rx', 'me', f.kind, 'from peer');
      const meResp1 = runSyncStep(mine, meInbound1);
      for (const buf of meResp1.outboundFrames) {
        const { dag } = drainDagFrames(buf);
        for (const f of dag) logFrame('tx', 'me', f.kind, `to peer · ${f.body.length}B body`);
      }

      // Peer ingests our NODE frames
      const flatMeBytes = concatBytes(meResp1.outboundFrames);
      const { dag: peerInbound2 } = drainDagFrames(flatMeBytes);
      for (const f of peerInbound2) logFrame('rx', 'peer', f.kind, 'from me');
      const peerResp2 = runSyncStep(peer, peerInbound2);
      logFrame('rx', 'peer', FRAME_KIND_NODE, `inserted ${peerResp2.insertedNodeIds.length} node(s)`);

      // Reverse direction: Peer → Me HEADS (so we get whatever peer-only nodes back)
      const peerHeadsFrame = buildHeadsFrame(peer);
      logFrame('tx', 'peer', FRAME_KIND_HEADS, `heads=${peer.heads().length}`);
      const { dag: meInbound2 } = drainDagFrames(peerHeadsFrame);
      for (const f of meInbound2) logFrame('rx', 'me', f.kind, 'from peer');
      const meResp2 = runSyncStep(mine, meInbound2);
      const flatMyWant = concatBytes(meResp2.outboundFrames);
      const { dag: peerInbound3 } = drainDagFrames(flatMyWant);
      for (const f of peerInbound3) logFrame('rx', 'peer', f.kind, 'from me');
      const peerResp3 = runSyncStep(peer, peerInbound3);
      const flatPeerNodes = concatBytes(peerResp3.outboundFrames);
      const { dag: meInbound3 } = drainDagFrames(flatPeerNodes);
      for (const f of meInbound3) logFrame('rx', 'me', f.kind, 'from peer');
      const meResp3 = runSyncStep(mine, meInbound3);
      logFrame('rx', 'me', FRAME_KIND_NODE, `inserted ${meResp3.insertedNodeIds.length} node(s)`);
    } finally {
      setBusy(false);
      refreshSnapshots();
    }
  }, [busy, logFrame, refreshSnapshots]);

  const clearAll = useCallback(() => {
    myStoreRef.current?.clear();
    peerStoreRef.current?.clear();
    setLogs([]);
    refreshSnapshots();
  }, [refreshSnapshots]);

  const runWebRtcSmoke = useCallback(async () => {
    if (webrtcBusy) return;
    setWebrtcBusy(true);
    setWebrtcResult(null);
    try {
      const result = await smokeTestPair();
      setWebrtcResult(result);
    } finally {
      setWebrtcBusy(false);
    }
  }, [webrtcBusy]);

  const handleResetDevKey = useCallback(() => {
    resetDevKey();
    try {
      const { privkey, pubkeyHex: pk } = loadOrCreateDevKey();
      privkeyRef.current = privkey;
      setPubkeyHex(pk);
    } catch (err) {
      setPubkeyHex(`error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    clearAll();
  }, [clearAll]);

  const handshakePayload = useMemo<HandshakePayload | null>(() => {
    if (!pubkeyHex) return null;
    const ice = iceServers
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { v: 1, pubkey: pubkeyHex, ice };
  }, [pubkeyHex, iceServers]);

  const handshakeJson = useMemo(
    () => (handshakePayload ? JSON.stringify(handshakePayload) : ''),
    [handshakePayload]
  );

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title="P2P Lab" />
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
      <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="P2P Lab" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              DAG three-step sync (HEADS → WANT → NODE) over an in-memory mock peer. The exact same `runSyncStep` will drive the BLE + WebRTC transport once §3.3 wire integration lands.
            </Text>
          </View>

          <SettingsBlockSection
            title="Sandbox key"
            footer="secp256k1 (BIP-340 schnorr). Stored in MMKV `dev:secp256k1:v1`. NEVER linked to the production Spruce DID; never exported through the public backup flow."
          >
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text
                className="text-text3 text-[11px]"
                style={{ marginBottom: 4 }}
              >
                {keyReady ? 'PUBKEY (x-only)' : 'GENERATING…'}
              </Text>
              <Text
                className="text-text1 text-[11px]"
                style={{ fontFamily: 'Menlo' }}
                numberOfLines={2}
                selectable
              >
                {pubkeyHex || '—'}
              </Text>
            </View>
          </SettingsBlockSection>

          <SettingsBlockSection
            title="ICE servers"
            footer={
              'Empty = LAN-direct only (no STUN/TURN). Paste comma-separated STUN URLs for cross-room testing — exposes your IP to that operator (§13.1). Never persisted across app restarts (§13.2 spirit).'
            }
          >
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <TextInput
                value={iceServers}
                onChangeText={setIceServers}
                placeholder="(empty)  e.g. stun:stun.l.google.com:19302"
                placeholderTextColor={Colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ color: Colors.text1, fontSize: 13, fontFamily: 'Menlo' }}
              />
            </View>
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Handshake QR"
            footer="JSON-encoded sandbox key + ICE list. Scan-peer flow lands when camera integration ships in §3.3 phase 2."
          >
            {handshakeJson ? (
              <View
                className="bg-mutedSurface rounded-xl items-center"
                style={{ paddingVertical: 16 }}
              >
                <QRCode value={handshakeJson} size={180} backgroundColor="#FFF" />
                <Text
                  className="text-text3 text-[10px]"
                  style={{ fontFamily: 'Menlo', marginTop: 8, paddingHorizontal: 12 }}
                  numberOfLines={2}
                  selectable
                >
                  {handshakeJson}
                </Text>
              </View>
            ) : (
              <View
                className="bg-mutedSurface rounded-xl"
                style={{ paddingHorizontal: 14, paddingVertical: 14 }}
              >
                <Text className="text-text2 text-[13px]">Generating…</Text>
              </View>
            )}
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Stores"
            footer="Two in-memory DAG stores: 'Mine' and 'Mock Peer'. Append nodes to either, then run a sync round to converge them."
          >
            <SettingsBlockRow
              icon="plus.square"
              title="Append test node → Mine"
              subtitle={`Mine count: ${String(myCount)} · heads: ${String(myHeads.length)}`}
              onPress={() => { appendTestNode('me'); }}
            />
            <SettingsBlockRow
              icon="plus.square.dashed"
              title="Append test node → Mock Peer"
              subtitle={`Peer count: ${String(peerCount)} · heads: ${String(peerHeads.length)}`}
              onPress={() => { appendTestNode('peer'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Sync"
            footer="Drives the three-step protocol both directions. Watch the transport log below for HEADS/WANT/NODE frames."
          >
            <SettingsBlockRow
              icon="arrow.triangle.2.circlepath"
              title={busy ? 'Syncing…' : 'Sync round (both directions)'}
              subtitle={busy ? 'Running…' : 'me ⇌ peer'}
              onPress={() => { void runSyncRound(); }}
            />
            <SettingsBlockRow
              icon="trash"
              title="Clear stores + log"
              onPress={clearAll}
            />
            <SettingsBlockRow
              icon="key.slash"
              title="Reset sandbox key (regenerate)"
              onPress={handleResetDevKey}
            />
          </SettingsBlockSection>

          <SettingsBlockSection
            title="WebRTC"
            footer={
              webrtcResult
                ? `Last smoke test: ${webrtcResult.status} · ${webrtcResult.elapsedMs.toFixed(0)}ms · ${webrtcResult.note}`
                : 'In-process pair smoke test: builds two RTCPeerConnections in the same app, exchanges offer/answer + ICE, opens DataChannel, sends a ping. Verifies the LAN-direct wrapper works without a second device.'
            }
          >
            <SettingsBlockRow
              icon="antenna.radiowaves.left.and.right"
              title={webrtcBusy ? 'Running smoke test…' : 'Smoke test WebRTC pair'}
              subtitle="iceServers:[] · DataChannel solidarity-dag-v1"
              onPress={() => { void runWebRtcSmoke(); }}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`Transport log (last ${String(Math.min(logs.length, LOG_MAX))})`}
              </Text>
            </View>
            <View className="px-4 gap-1">
              {logs.length === 0 ? (
                <Text className="text-text3 text-[12px]">No frames yet.</Text>
              ) : (
                logs.map((entry) => (
                  <View
                    key={`${String(entry.ts)}-${entry.direction}-${String(entry.frameKind)}-${entry.note.slice(0, 8)}`}
                    className="bg-mutedSurface rounded-md"
                    style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text
                      className="text-text1 text-[11px]"
                      style={{ fontFamily: 'Menlo' }}
                    >
                      {`${entry.direction === 'tx' ? '→' : '←'} ${entry.side} · ${frameLabel(entry.frameKind)}`}
                    </Text>
                    <Text className="text-text3 text-[10px]" style={{ marginTop: 2 }}>
                      {entry.note}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
