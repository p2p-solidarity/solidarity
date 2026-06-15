/**
 * UWB Bump Lab — sandbox-only screen that drives the bump state machine
 * via `createBumpDriver`, surfaces the live state and transition log,
 * and lets a developer simulate the three canonical sequences from
 * docs §10 without needing a second phone.
 *
 * Spec: dev-sandbox-identity-graph.md §3.3.1 (UX), §13.4 (driver split),
 * §13.5 (consent rules).
 *
 * Real exchanges never happen here — `invitePeer` is a noop. The Lab
 * exists to verify the haptic ladder + visual flash + state-machine
 * transitions before the same driver gets wired into a future public
 * Share-tab integration. Two-phone real bumps land in P2P Lab once the
 * BLE multiplex + WebRTC sync are in.
 */
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BumpFlash } from '@/components/sandbox/BumpFlash';
import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import {
  attachBumpDriverToNitro,
  detachBumpDriverFromNitro,
  invitePeerViaNitro,
} from '@/matching/bumpDriverAttach';
import {
  type BumpDriver,
  type BumpEvent,
  type BumpHapticKind,
  type BumpReason,
  type ProximitySignalSource,
  createBumpDriver,
} from '@/matching/uwbBumpDriver';
import type { UwbSpatialState } from '@/matching/types';
import { usePreferences } from '@/settings/preferences';

const TEST_BUMP_UWB_SEQ = [0.50, 0.20, 0.08, 0.08, 0.08] as const;
const TEST_PULLAWAY_UWB_SEQ = [0.00, 0.50, 0.20, 0.08, 0.08, 0.40] as const;
const TEST_BUMP_RSSI_SEQ = [-80, -60, -45, -45, -45] as const;
const SIMULATE_STEP_MS = 80;
const CONSENT_AUTO_DECLINE_MS = 3000;
const FLASH_DURATION_MS = 600;
const LOG_MAX = 30;

interface PeerView {
  readonly peerId: string;
  readonly state: UwbSpatialState;
  readonly source: ProximitySignalSource | null;
}

interface LogEntry {
  readonly ts: number;
  readonly peerId: string;
  readonly from: UwbSpatialState['kind'];
  readonly to: UwbSpatialState['kind'];
  readonly signal: ProximitySignalSource;
  readonly distanceCm?: number;
  readonly rssiDbm?: number;
  readonly note: string;
}

interface ConsentSheet {
  readonly peerId: string;
  readonly reason: BumpReason;
  readonly expiresAt: number;
}

const REASON_LABEL: Readonly<Record<BumpReason, string>> = {
  rssi: 'RSSI-only device — confirm to accept',
  sameSession: 'Already exchanged with this peer this session',
  alwaysConfirm: '"Always confirm" is on',
};

function stateLabel(state: UwbSpatialState): string {
  switch (state.kind) {
    case 'approaching': return `approaching (${String(state.framesSeen)}/${String(state.requiredFrames)})`;
    case 'confirmed':   return 'confirmed';
    case 'exchanging':  return 'exchanging';
    case 'cooldown':    return 'cooldown';
    default:            return 'idle';
  }
}

function stateColor(state: UwbSpatialState): string {
  switch (state.kind) {
    case 'approaching': return '#FF9500';
    case 'confirmed':
    case 'exchanging':  return Colors.terminalGreen;
    case 'cooldown':    return Colors.text3;
    default:            return Colors.text3;
  }
}

// Hoisted to a stable ref — inline `options={{ presentation: 'modal' }}` is a
// new object each render → expo-router setOptions loop → "Maximum update depth".
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;

export default function BumpLab() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const [alwaysConfirm, setAlwaysConfirm] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);
  const [peers, setPeers] = useState<readonly PeerView[]>([]);
  const [logs, setLogs] = useState<readonly LogEntry[]>([]);
  const [flashing, setFlashing] = useState(false);
  const [consent, setConsent] = useState<ConsentSheet | null>(null);
  const driverRef = useRef<BumpDriver | null>(null);
  const consentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveModeRef = useRef(false);
  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  // Driver lives one instance per Lab session. Re-created when the
  // alwaysConfirm flag flips so the new config takes effect; state
  // resets are intentional — it's a debugger surface.
  useEffect(() => {
    if (!developerMode) return undefined;
    const driver = createBumpDriver({
      alwaysConfirm,
      onHaptic: (kind: BumpHapticKind) => { haptic(kind); },
      invitePeer: (peerId: string) => {
        // In Live mode a `confirmed` transition really invites the peer
        // over BLE; simulate-only peers (sim-*) never resolve via Nitro
        // because they aren't in the proximity registry — safely noops.
        if (liveModeRef.current) {
          void invitePeerViaNitro(peerId);
        }
      },
      onEvent: (event: BumpEvent) => {
        if (event.kind === 'stateChanged') {
          setPeers((cur) => mergePeerState(cur, event.peerId, event.state));
        } else if (event.kind === 'flashRequested') {
          setFlashing(true);
          setTimeout(() => { setFlashing(false); }, FLASH_DURATION_MS);
        } else if (event.kind === 'consentSheetRequested') {
          if (consentTimerRef.current) clearTimeout(consentTimerRef.current);
          const expiresAt = Date.now() + CONSENT_AUTO_DECLINE_MS;
          setConsent({ peerId: event.peerId, reason: event.reason, expiresAt });
          consentTimerRef.current = setTimeout(() => {
            setConsent(null);
            consentTimerRef.current = null;
          }, CONSENT_AUTO_DECLINE_MS);
        } else if (event.kind === 'transitionLog') {
          setLogs((cur) => [
            {
              ts: Date.now(),
              peerId: event.peerId,
              from: event.from,
              to: event.to,
              signal: event.signal,
              ...(typeof event.distanceM === 'number' ? { distanceCm: event.distanceM * 100 } : {}),
              ...(typeof event.rssiDbm === 'number' ? { rssiDbm: event.rssiDbm } : {}),
              note: event.note,
            },
            ...cur,
          ].slice(0, LOG_MAX));
        }
      },
    });
    driverRef.current = driver;
    setPeers([]);
    setLogs([]);
    return () => {
      driverRef.current = null;
      detachBumpDriverFromNitro();
      if (consentTimerRef.current) {
        clearTimeout(consentTimerRef.current);
        consentTimerRef.current = null;
      }
    };
  }, [developerMode, alwaysConfirm]);

  // Drive Live attach/detach as the toggle flips. Re-attach is a no-op
  // when already subscribed (bumpDriverAttach is idempotent).
  useEffect(() => {
    if (!developerMode) return;
    const driver = driverRef.current;
    if (!driver) return;
    if (liveMode) {
      void attachBumpDriverToNitro(driver).then((ok) => { setLiveAvailable(ok); });
    } else {
      detachBumpDriverFromNitro();
    }
  }, [developerMode, liveMode, alwaysConfirm]);

  const totalCount = peers.length;
  const activeStates = useMemo(
    () => peers.filter((p) => p.state.kind !== 'idle'),
    [peers]
  );

  const runUwbBump = useCallback(async () => {
    const d = driverRef.current;
    if (!d) return;
    await d.simulateProgression('sim-uwb', 'uwb', TEST_BUMP_UWB_SEQ, SIMULATE_STEP_MS);
  }, []);

  const runUwbPullAway = useCallback(async () => {
    const d = driverRef.current;
    if (!d) return;
    await d.simulateProgression('sim-pull', 'uwb', TEST_PULLAWAY_UWB_SEQ, SIMULATE_STEP_MS);
  }, []);

  const runRssiBump = useCallback(async () => {
    const d = driverRef.current;
    if (!d) return;
    await d.simulateProgression('sim-rssi', 'rssi', TEST_BUMP_RSSI_SEQ, SIMULATE_STEP_MS);
  }, []);

  const handleAcceptConsent = useCallback(() => {
    const d = driverRef.current;
    if (!d || !consent) return;
    d.forceCooldown(consent.peerId);
    if (consentTimerRef.current) clearTimeout(consentTimerRef.current);
    consentTimerRef.current = null;
    setConsent(null);
  }, [consent]);

  const handleDeclineConsent = useCallback(() => {
    const d = driverRef.current;
    if (!d || !consent) return;
    d.forceIdle(consent.peerId);
    if (consentTimerRef.current) clearTimeout(consentTimerRef.current);
    consentTimerRef.current = null;
    setConsent(null);
  }, [consent]);

  const handleForceIdle = useCallback(() => {
    const d = driverRef.current;
    if (!d) return;
    for (const p of peers) {
      d.forceIdle(p.peerId);
    }
  }, [peers]);

  const handleResetSession = useCallback(() => {
    const d = driverRef.current;
    if (!d) return;
    d.resetSessionMemory();
    setLogs([]);
  }, []);

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title="UWB Bump Lab" />
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
      <SettingsScreenTitle title="UWB Bump Lab" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              Drives `UwbSpatialState` from simulated distance/RSSI streams. Per docs §13.4, real device detection (UWB vs RSSI) lands when the driver is wired into `useMatchingSession`; today this Lab is signal-source-agnostic and the simulate buttons hand-pick the branch.
            </Text>
            <Text className="text-text3 text-[12px]" style={{ marginTop: 8 }}>
              {`Platform: ${Platform.OS}. Bump invitations are NOT sent — this Lab is for the state machine + haptic + visual cue only.`}
            </Text>
          </View>

          <SettingsBlockSection
            title="Settings"
            footer={
              liveMode && liveAvailable === false
                ? 'Live mode attempted, but @solidarity/nitro-proximity is unavailable on this build. Use simulate buttons instead.'
                : 'When Live is on, the driver subscribes to the nitro-proximity event stream and auto-invite fires real BLE invitations on `confirmed`. Always Confirm forces the 3-second sheet even on UWB devices.'
            }
          >
            <SettingsBlockToggleRow
              icon="dot.radiowaves.left.and.right"
              title="Live (attach to BLE proximity)"
              subtitle="Requires Start Matching on the Share tab"
              value={liveMode}
              onValueChange={(v) => { setLiveMode(v); }}
            />
            <SettingsBlockToggleRow
              icon="checkmark.shield"
              title="Always confirm bumps"
              value={alwaysConfirm}
              onValueChange={(v) => { setAlwaysConfirm(v); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Simulate"
            footer="Sequences from docs §10. UWB bump: 50→20→8→8→8 cm fires soft + heavy + flash + auto-invite. Pull away: 0→50→20→8→8→40 cm returns to idle with zero haptics. RSSI bump: −80→−60→−45→−45→−45 dBm always shows the consent sheet."
          >
            <SettingsBlockRow
              icon="hand.tap"
              title="UWB bump (auto-invite)"
              subtitle="sim-uwb peer · 50→20→8→8→8 cm"
              onPress={() => { void runUwbBump(); }}
            />
            <SettingsBlockRow
              icon="arrow.uturn.backward"
              title="Pull away before threshold"
              subtitle="sim-pull peer · returns to idle"
              onPress={() => { void runUwbPullAway(); }}
            />
            <SettingsBlockRow
              icon="dot.radiowaves.left.and.right"
              title="RSSI bump (consent sheet)"
              subtitle="sim-rssi peer · −80→−45 dBm"
              onPress={() => { void runRssiBump(); }}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`Peers (${String(totalCount)} seen · ${String(activeStates.length)} active)`}
              </Text>
            </View>
            <View className="px-4 gap-2">
              {peers.length === 0 ? (
                <View
                  className="bg-mutedSurface rounded-xl flex-row items-center"
                  style={{ paddingHorizontal: 14, paddingVertical: 14 }}
                >
                  <Text className="text-text2 text-[13px] flex-1">
                    No peers yet — run a simulate button above.
                  </Text>
                </View>
              ) : (
                peers.map((p) => (
                  <View
                    key={p.peerId}
                    className="bg-mutedSurface rounded-xl"
                    style={{ paddingHorizontal: 14, paddingVertical: 12 }}
                  >
                    <View className="flex-row items-center" style={{ marginBottom: 4 }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          marginRight: 8,
                          backgroundColor: stateColor(p.state),
                        }}
                      />
                      <Text
                        className="text-text1 text-[13px] font-semibold"
                        style={{ fontFamily: 'Menlo', flex: 1 }}
                      >
                        {p.peerId}
                      </Text>
                      <Text
                        className="text-text2 text-[12px]"
                        style={{ fontFamily: 'Menlo' }}
                      >
                        {stateLabel(p.state)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`Transitions (last ${String(Math.min(logs.length, LOG_MAX))})`}
              </Text>
            </View>
            <View className="px-4 gap-1">
              {logs.length === 0 ? (
                <Text className="text-text3 text-[12px]">No transitions yet.</Text>
              ) : (
                logs.map((entry) => (
                  <View
                    key={`${String(entry.ts)}-${entry.peerId}`}
                    className="bg-mutedSurface rounded-md"
                    style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text
                      className="text-text1 text-[11px]"
                      style={{ fontFamily: 'Menlo' }}
                    >
                      {`${entry.peerId} · ${entry.from} → ${entry.to} · ${entry.signal}${
                        typeof entry.distanceCm === 'number'
                          ? ` @ ${entry.distanceCm.toFixed(0)}cm`
                          : typeof entry.rssiDbm === 'number'
                          ? ` @ ${String(entry.rssiDbm)}dBm`
                          : ''
                      }`}
                    </Text>
                    <Text className="text-text3 text-[10px]" style={{ marginTop: 2 }}>
                      {entry.note}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

          <SettingsBlockSection
            title="Escape hatches"
            footer="Use after a stuck simulation. Reset session memory mirrors the Start Matching toggle in production — clears the same-peer-twice set."
          >
            <SettingsBlockRow
              icon="arrow.counterclockwise"
              title="Force all peers to idle"
              onPress={handleForceIdle}
            />
            <SettingsBlockRow
              icon="trash"
              title="Reset session memory + log"
              onPress={handleResetSession}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>

      <BumpFlash visible={flashing} />

      {consent ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 24 + insets.bottom,
          }}
        >
          <View
            className="bg-cardBg rounded-2xl"
            style={{
              paddingHorizontal: 16,
              paddingVertical: 16,
              borderWidth: 1,
              borderColor: Colors.divider,
            }}
          >
            <Text className="text-text1 text-[15px] font-semibold">
              {`Bumped with ${consent.peerId}`}
            </Text>
            <Text className="text-text2 text-[12px]" style={{ marginTop: 4 }}>
              {REASON_LABEL[consent.reason]}. Auto-declines in 3s.
            </Text>
            <View className="flex-row gap-2" style={{ marginTop: 12 }}>
              <Pressable
                onPress={handleDeclineConsent}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: Colors.divider,
                  borderRadius: 10,
                  paddingVertical: 10,
                  alignItems: 'center',
                }}
                className="active:opacity-70"
              >
                <Text className="text-text1 text-[13px]">Decline</Text>
              </Pressable>
              <Pressable
                onPress={handleAcceptConsent}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  backgroundColor: Colors.terminalGreen,
                  borderRadius: 10,
                  paddingVertical: 10,
                  alignItems: 'center',
                }}
                className="active:opacity-70"
              >
                <Text style={{ color: '#000', fontSize: 13, fontWeight: '600' }}>Accept</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function mergePeerState(
  cur: readonly PeerView[],
  peerId: string,
  state: UwbSpatialState
): readonly PeerView[] {
  const idx = cur.findIndex((p) => p.peerId === peerId);
  if (idx >= 0) {
    const next = cur.slice();
    const existing = next[idx];
    if (!existing) return cur;
    next[idx] = { peerId, state, source: existing.source };
    return next;
  }
  return [...cur, { peerId, state, source: null }];
}
