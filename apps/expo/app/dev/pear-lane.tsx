/**
 * Pear Lane Lab — A3.3: the loopback lab now runs the FULL mutual
 * DID-challenge handshake (`src/pear/handshake.ts`) over the real relay
 * path — RN(A) -> worklet(A) -> Noise socket -> worklet(B) -> RN(B), and
 * back — not just a raw ping/pong (that was A3.2). A "Cross-device" mode
 * sits alongside it for the real two-device PoC the human runs off
 * `docs/ref/notes-pear-poc.md` (LTE↔WiFi, symmetric NAT, …) — out of this
 * task's scope to execute, but the UI + wiring here is what makes those
 * runs turnkey.
 *
 * Both modes go through `src/pear/laneManager.ts` (A3.3) instead of calling
 * `startLane`/`shutdown` directly, so a lane started from this screen is
 * covered by the shared AppState background/foreground policy for free.
 *
 * HONESTY NOTE (apps/expo/CLAUDE.md "No fake data" + this task's
 * verification requirement): `swarm.join()` needs real DHT bootstrap (UDP
 * egress). On a network that blocks it (sandboxed CI, some
 * corporate/simulator networks), this legitimately times out — the UI must
 * show that as the real `error` state, never a fabricated "connected" or
 * "authenticated". There is no synthetic fallback path here.
 *
 * Gated by Developer Mode like every sibling `/dev/*` lab. Lanes are
 * released (not just refs dropped) on unmount/re-run so navigating away
 * mid-run never leaks a live Bare worklet.
 */
import { p256 } from '@noble/curves/nist.js';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  didKeyFromPublicKey,
  deriveP256Scalar,
  HKDF_INFO_ROOT,
  publicKeyFromPrivate,
  type Signer,
} from '@solidarity/shared';

import { SettingsBackToolbar, SettingsBlockRow, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { useTranslation } from '@/i18n';
import { authenticateChannel, type AuthenticatedChannel } from '@/pear/handshake';
import { ensureLane, releaseLane } from '@/pear/laneManager';
import { pearTopicFor, type PearChannel } from '@/pear/lane';
import { usePreferences } from '@/settings/preferences';

const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;
/** DHT bootstrap + connect + handshake + one ping/pong round trip,
 *  generously bounded. Real hyperswarm joins on a healthy network settle in
 *  low single-digit seconds and the handshake has its own 15s internal
 *  timeout (`HANDSHAKE_TIMEOUT_MS`); this only needs to be long enough to
 *  distinguish "still trying" from "genuinely unreachable". */
const LOOPBACK_TIMEOUT_MS = 30_000;
/** Cross-device gets more slack — real network discovery (possibly through
 *  a relay/TURN-equivalent path on symmetric NAT) is slower than the
 *  in-process loopback. */
const CROSS_DEVICE_TIMEOUT_MS = 60_000;

const LOOPBACK_LANE_A_ID = 'dev:pear-lane-loopback:a';
const LOOPBACK_LANE_B_ID = 'dev:pear-lane-loopback:b';
const CROSS_DEVICE_LANE_ID = 'dev:pear-lane-cross-device';

/** Not security-sensitive — a per-run correlation token for a lab topic or
 *  ping/pong nonce, not a key or credential. */
function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ── TEST-ONLY identities for the in-process loopback lab ───────────────────
//
// These two mnemonics are the famous, PUBLIC BIP-39 reference test vectors
// (trezor/bip39 "vectors.json" #1 and #2) — never used to secure anything
// real, safe to hardcode, safe to see in a screenshot. Derived through the
// exact same `deriveP256Scalar(mnemonic, HKDF_INFO_ROOT)` path
// `src/identity/rootKey.ts` uses for the PRODUCTION root key, so this lab
// exercises the real derivation — it just never touches SecureStore or Face
// ID. The production root key is what "Cross-device" mode below uses
// instead; the two are never mixed.
const TEST_MNEMONIC_ALICE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_MNEMONIC_BOB =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

interface TestIdentity {
  readonly did: string;
  readonly signer: Signer;
}

function testIdentityFromMnemonic(mnemonic: string): TestIdentity {
  const scalar = deriveP256Scalar(mnemonic, HKDF_INFO_ROOT);
  const did = didKeyFromPublicKey(publicKeyFromPrivate(scalar));
  const signer: Signer = async (digest) => p256.sign(digest, scalar, { prehash: false });
  return { did, signer };
}

const ALICE_TEST = testIdentityFromMnemonic(TEST_MNEMONIC_ALICE);
const BOB_TEST = testIdentityFromMnemonic(TEST_MNEMONIC_BOB);

function rootKeyErrorMessage(error: RootKeyError, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (error.kind) {
    case 'notProvisioned':
      return t('developer.pearLane.crossDevice.rootKeyNotProvisioned');
    case 'biometricDenied':
      return t('developer.pearLane.crossDevice.biometricDenied');
    case 'invalidMnemonic':
    case 'storageFailed':
      return t('developer.pearLane.crossDevice.rootKeyStorageError', { message: error.message });
  }
}

// ── Loopback lab (two in-process test identities) ──────────────────────────

type LaneLoopbackState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'discovering'; readonly topic: string }
  | { readonly kind: 'handshaking'; readonly topic: string }
  | { readonly kind: 'authenticated'; readonly topic: string }
  | { readonly kind: 'frame-received'; readonly topic: string; readonly roundTripMs: number; readonly frame: string }
  | { readonly kind: 'error'; readonly message: string };

function LoopbackLab() {
  const { t } = useTranslation();
  const [state, setState] = useState<LaneLoopbackState>({ kind: 'idle' });

  const unsubscribersRef = useRef<(() => void)[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Drops listeners, clears the timeout, and releases both loopback lanes
  // via the shared manager. Safe to call more than once — used both
  // mid-run (settle) and on unmount.
  const teardown = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    for (const unsubscribe of unsubscribersRef.current) unsubscribe();
    unsubscribersRef.current = [];
    releaseLane(LOOPBACK_LANE_A_ID);
    releaseLane(LOOPBACK_LANE_B_ID);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const settle = useCallback(
    (next: LaneLoopbackState) => {
      teardown();
      if (mountedRef.current) setState(next);
    },
    [teardown]
  );

  const run = useCallback(() => {
    teardown();

    const topic = pearTopicFor(`dev:pear-lane-loopback:${randomToken()}`);
    setState({ kind: 'discovering', topic });

    const laneA = ensureLane(LOOPBACK_LANE_A_ID);
    if (!laneA.ok) {
      setState({ kind: 'error', message: t('developer.pearLane.startError', { message: laneA.error.message }) });
      return;
    }
    const laneB = ensureLane(LOOPBACK_LANE_B_ID);
    if (!laneB.ok) {
      releaseLane(LOOPBACK_LANE_A_ID);
      setState({ kind: 'error', message: t('developer.pearLane.startError', { message: laneB.error.message }) });
      return;
    }

    const channelA: PearChannel = laneA.value.joinTopic(topic);
    const channelB: PearChannel = laneB.value.joinTopic(topic);

    let sawOpen = false;
    unsubscribersRef.current = [
      channelA.onCtrl((ev) => {
        if (ev.ev === 'open' && !sawOpen && mountedRef.current) {
          sawOpen = true;
          setState({ kind: 'handshaking', topic });
        }
      }),
    ];

    timeoutRef.current = setTimeout(() => {
      settle({ kind: 'error', message: t('developer.pearLane.timeoutError') });
    }, LOOPBACK_TIMEOUT_MS);

    // Both sides start authenticating immediately (before `open` can fire) —
    // `authenticateChannel` itself waits for the ctrl 'open' event. Not
    // strictly required (a late subscriber gets `open` replayed by
    // `lane.ts`), but there's no reason to delay here.
    const aliceAuth = authenticateChannel(channelA, {
      myDid: ALICE_TEST.did,
      peerDid: BOB_TEST.did,
      signer: ALICE_TEST.signer,
    });
    const bobAuth = authenticateChannel(channelB, {
      myDid: BOB_TEST.did,
      peerDid: ALICE_TEST.did,
      signer: BOB_TEST.signer,
    });

    void Promise.all([aliceAuth, bobAuth]).then(([aliceResult, bobResult]) => {
      if (!mountedRef.current) return;
      if (!aliceResult.ok) {
        settle({ kind: 'error', message: t('developer.pearLane.handshakeError', { message: aliceResult.error }) });
        return;
      }
      if (!bobResult.ok) {
        settle({ kind: 'error', message: t('developer.pearLane.handshakeError', { message: bobResult.error }) });
        return;
      }

      setState({ kind: 'authenticated', topic });
      runAuthenticatedRoundTrip(aliceResult.value, bobResult.value, unsubscribersRef, (roundTripMs, frame) => {
        settle({ kind: 'frame-received', topic, roundTripMs, frame });
      });
    });
  }, [settle, t, teardown]);

  const busy = state.kind === 'discovering' || state.kind === 'handshaking' || state.kind === 'authenticated';
  const rowTitle = busy ? t('developer.pearLane.runningTitle') : t('developer.pearLane.runTitle');
  const rowSubtitle = ((): string => {
    switch (state.kind) {
      case 'idle':
        return t('developer.pearLane.idleSubtitle');
      case 'discovering':
        return t('developer.pearLane.discoveringSubtitle');
      case 'handshaking':
        return t('developer.pearLane.handshakingSubtitle');
      case 'authenticated':
        return t('developer.pearLane.authenticatedSubtitle');
      case 'frame-received':
        return t('developer.pearLane.frameReceivedSubtitle', { ms: state.roundTripMs });
      case 'error':
        return state.message;
    }
  })();

  return (
    <View className="px-4 pt-4 gap-4">
      <Text className="text-text2 text-[13px]">
        {t('developer.pearLane.description')}
      </Text>
      <SettingsBlockRow
        icon="dot.radiowaves.left.and.right"
        title={rowTitle}
        subtitle={rowSubtitle}
        onPress={run}
        disabled={busy}
      />
      {state.kind !== 'idle' && state.kind !== 'error' ? (
        <Text className="text-text3 text-[11px]" numberOfLines={1}>
          {t('developer.pearLane.topicLabel', { topic: state.topic })}
        </Text>
      ) : null}
      {state.kind === 'frame-received' ? (
        <Text className="text-text3 text-[11px]">
          {t('developer.pearLane.frameLabel', { frame: state.frame })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Shared post-authentication smoke test for both labs: the "initiator"
 * sends `dev.ping`, the "responder" echoes `dev.pong`, and the initiator
 * reports the round trip it measured. `responder` is `null` when the two
 * sides are on separate devices and this call only owns the initiator half
 * (the cross-device "wait" role runs its own echo-only handler instead of
 * this helper — see `CrossDeviceLab`, which never measures a round trip
 * since it doesn't hold the send timestamp).
 */
function runAuthenticatedRoundTrip(
  initiator: AuthenticatedChannel,
  responder: AuthenticatedChannel | null,
  unsubscribersRef: { current: (() => void)[] },
  onRoundTrip: (roundTripMs: number, frame: string) => void
): void {
  const nonce = randomToken();
  let sentAt = 0;

  if (responder) {
    const unsubResponder = responder.onFrame((frame) => {
      if (frame['t'] === 'dev.ping' && frame['nonce'] === nonce) {
        responder.send({ t: 'dev.pong', nonce, echoedAt: Date.now() });
      }
    });
    unsubscribersRef.current.push(unsubResponder);
  }

  const unsubInitiator = initiator.onFrame((frame) => {
    if (frame['t'] === 'dev.pong' && frame['nonce'] === nonce) {
      onRoundTrip(Date.now() - sentAt, JSON.stringify(frame));
    }
  });
  unsubscribersRef.current.push(unsubInitiator);

  sentAt = Date.now();
  initiator.send({ t: 'dev.ping', nonce, sentAt });
}

// ── Cross-device lab (production root identity, Face ID gated) ─────────────

type CrossDeviceRole = 'wait' | 'dial';

type CrossDeviceState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'discovering'; readonly topic: string }
  | { readonly kind: 'handshaking'; readonly topic: string }
  | { readonly kind: 'authenticated'; readonly topic: string }
  // "dial" measured a real round trip (it holds the send timestamp).
  | { readonly kind: 'frame-received'; readonly topic: string; readonly roundTripMs: number; readonly frame: string }
  // "wait" only ever echoes — it never sent the first frame, so there is no
  // round trip to report. A separate state (not `frame-received` with a
  // fabricated 0ms) keeps that distinction honest.
  | { readonly kind: 'echoed'; readonly topic: string; readonly frame: string }
  | { readonly kind: 'error'; readonly message: string };

type RootDidState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly did: string }
  | { readonly kind: 'error'; readonly message: string };

function CrossDeviceLab() {
  const { t } = useTranslation();
  const [rootDidState, setRootDidState] = useState<RootDidState>({ kind: 'loading' });
  const [role, setRole] = useState<CrossDeviceRole>('wait');
  const [peerDidInput, setPeerDidInput] = useState('');
  const [state, setState] = useState<CrossDeviceState>({ kind: 'idle' });

  const unsubscribersRef = useRef<(() => void)[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const teardown = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    for (const unsubscribe of unsubscribersRef.current) unsubscribe();
    unsubscribersRef.current = [];
    releaseLane(CROSS_DEVICE_LANE_ID);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void getRootDid().then((result) => {
      if (!mountedRef.current) return;
      setRootDidState(result.ok ? { kind: 'ready', did: result.value } : { kind: 'error', message: rootKeyErrorMessage(result.error, t) });
    });
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [t, teardown]);

  const settle = useCallback(
    (next: CrossDeviceState) => {
      teardown();
      if (mountedRef.current) setState(next);
    },
    [teardown]
  );

  const start = useCallback(() => {
    teardown();
    if (rootDidState.kind !== 'ready') return;
    const peerDid = peerDidInput.trim();
    if (!peerDid) {
      setState({ kind: 'error', message: t('developer.pearLane.crossDevice.missingPeerDid') });
      return;
    }
    const myDid = rootDidState.did;
    // Topic is always keyed off the WAITING side's did — matches
    // `pearTopicFor`'s production contract (topic = hash of the did being
    // reached). "wait" joins the topic for its own did; "dial" joins the
    // topic derived from the peer did it was given out of band.
    const topic = pearTopicFor(role === 'wait' ? myDid : peerDid);
    setState({ kind: 'discovering', topic });

    // Resolve the signer BEFORE joining the topic. This ordering used to be
    // load-bearing for correctness (a channel's `open` firing while we were
    // still `await`-ing a signer would have been missed entirely), but
    // `PearChannel.onCtrl` now replays a topic's last ctrl event to a
    // late-attaching subscriber (`lane.ts`), so `authenticateChannel` would
    // still observe `open` even across this `await` gap. Kept anyway because
    // it avoids joining the topic (and incurring hyperswarm/DHT traffic) when
    // the signer isn't available. `getRootSigner()` itself never prompts
    // Face ID — only actually calling the returned `Signer` does, which
    // happens inside `authenticateChannel` once the peer's challenge arrives.
    void getRootSigner().then((signerResult) => {
      if (!mountedRef.current) return;
      if (!signerResult.ok) {
        settle({ kind: 'error', message: rootKeyErrorMessage(signerResult.error, t) });
        return;
      }

      const laneResult = ensureLane(CROSS_DEVICE_LANE_ID);
      if (!laneResult.ok) {
        settle({ kind: 'error', message: t('developer.pearLane.startError', { message: laneResult.error.message }) });
        return;
      }
      const channel = laneResult.value.joinTopic(topic, role === 'wait' ? 'server' : 'client');

      unsubscribersRef.current = [
        channel.onCtrl((ev) => {
          if (ev.ev === 'open' && mountedRef.current) {
            setState({ kind: 'handshaking', topic });
          } else if (ev.ev === 'error') {
            settle({ kind: 'error', message: t('developer.pearLane.ctrlError', { side: role, message: ev.message }) });
          }
        }),
      ];

      timeoutRef.current = setTimeout(() => {
        settle({ kind: 'error', message: t('developer.pearLane.timeoutError') });
      }, CROSS_DEVICE_TIMEOUT_MS);

      void authenticateChannel(channel, { myDid, peerDid, signer: signerResult.value }).then((authResult) => {
        if (!mountedRef.current) return;
        if (!authResult.ok) {
          settle({ kind: 'error', message: t('developer.pearLane.handshakeError', { message: authResult.error }) });
          return;
        }
        setState({ kind: 'authenticated', topic });
        const authed = authResult.value;
        if (role === 'dial') {
          runAuthenticatedRoundTrip(authed, null, unsubscribersRef, (roundTripMs, frame) => {
            settle({ kind: 'frame-received', topic, roundTripMs, frame });
          });
        } else {
          // "wait" only echoes — the dialer is the one measuring the round
          // trip, matching a real caller/callee asymmetry.
          const unsubEcho = authed.onFrame((frame) => {
            if (frame['t'] === 'dev.ping') {
              authed.send({ t: 'dev.pong', nonce: frame['nonce'], echoedAt: Date.now() });
              settle({ kind: 'echoed', topic, frame: JSON.stringify(frame) });
            }
          });
          unsubscribersRef.current.push(unsubEcho);
        }
      });
    });
  }, [peerDidInput, role, rootDidState, settle, t, teardown]);

  const busy = state.kind === 'discovering' || state.kind === 'handshaking' || state.kind === 'authenticated';
  const statusSubtitle = ((): string => {
    switch (state.kind) {
      case 'idle':
        return t('developer.pearLane.idleSubtitle');
      case 'discovering':
        return t('developer.pearLane.discoveringSubtitle');
      case 'handshaking':
        return t('developer.pearLane.handshakingSubtitle');
      case 'authenticated':
        return t('developer.pearLane.authenticatedSubtitle');
      case 'frame-received':
        return t('developer.pearLane.frameReceivedSubtitle', { ms: state.roundTripMs });
      case 'echoed':
        return t('developer.pearLane.crossDevice.echoedSubtitle');
      case 'error':
        return state.message;
    }
  })();

  return (
    <View className="px-4 pt-4 gap-4">
      <Text className="text-text2 text-[13px]">
        {t('developer.pearLane.crossDevice.warning')}
      </Text>

      <View className="bg-mutedSurface rounded-xl" style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text className="text-text3 text-[11px]" style={{ marginBottom: 4 }}>
          {t('developer.pearLane.crossDevice.myDidLabel')}
        </Text>
        <Text className="text-text1 text-[11px]" style={{ fontFamily: 'Menlo' }} numberOfLines={2} selectable>
          {rootDidState.kind === 'ready'
            ? rootDidState.did
            : rootDidState.kind === 'loading'
              ? t('developer.pearLane.crossDevice.myDidLoading')
              : rootDidState.message}
        </Text>
      </View>

      <View className="bg-mutedSurface rounded-xl flex-row" style={{ padding: 4 }}>
        {(['wait', 'dial'] as const).map((value) => {
          const active = role === value;
          const label = t(value === 'wait' ? 'developer.pearLane.crossDevice.roleWait' : 'developer.pearLane.crossDevice.roleDial');
          return (
            <Pressable
              key={value}
              onPress={() => { setRole(value); }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={label}
              className="flex-1 items-center rounded-lg active:opacity-80"
              style={{ paddingVertical: 8, backgroundColor: active ? Colors.cardBg : 'transparent' }}
            >
              <Text className="text-[13px]" style={{ color: active ? Colors.text1 : Colors.text2, fontWeight: active ? '600' : '400' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="bg-mutedSurface rounded-xl" style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text className="text-text3 text-[11px]" style={{ marginBottom: 4 }}>
          {t('developer.pearLane.crossDevice.peerDidLabel')}
        </Text>
        <TextInput
          value={peerDidInput}
          onChangeText={setPeerDidInput}
          placeholder={t('developer.pearLane.crossDevice.peerDidPlaceholder')}
          placeholderTextColor={Colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={{ color: Colors.text1, fontSize: 12, fontFamily: 'Menlo' }}
        />
      </View>

      <SettingsBlockRow
        icon={role === 'wait' ? 'antenna.radiowaves.left.and.right' : 'arrow.up.right.circle'}
        title={busy ? t('developer.pearLane.runningTitle') : t('developer.pearLane.crossDevice.startTitle')}
        subtitle={statusSubtitle}
        onPress={start}
        disabled={busy || rootDidState.kind !== 'ready'}
      />

      {state.kind !== 'idle' && state.kind !== 'error' ? (
        <Text className="text-text3 text-[11px]" numberOfLines={1}>
          {t('developer.pearLane.topicLabel', { topic: state.topic })}
        </Text>
      ) : null}

      <Text className="text-text3 text-[11px]">
        {t('developer.pearLane.crossDevice.footer')}
      </Text>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────

type LabMode = 'loopback' | 'cross-device';

export default function PearLaneLab() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const [mode, setMode] = useState<LabMode>('loopback');

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title={t('developer.pearLane.title')} />
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
      <SettingsScreenTitle title={t('developer.pearLane.title')} />

      <View className="px-4 pt-2">
        <View className="bg-mutedSurface rounded-xl flex-row" style={{ padding: 4 }}>
          {(['loopback', 'cross-device'] as const).map((value) => {
            const active = mode === value;
            const label = t(value === 'loopback' ? 'developer.pearLane.modeLoopback' : 'developer.pearLane.modeCrossDevice');
            return (
              <Pressable
                key={value}
                onPress={() => { setMode(value); }}
                accessibilityRole="button"
                accessibilityLabel={label}
                className="flex-1 items-center rounded-lg active:opacity-80"
                style={{ paddingVertical: 8, backgroundColor: active ? Colors.cardBg : 'transparent' }}
              >
                <Text className="text-[13px]" style={{ color: active ? Colors.text1 : Colors.text2, fontWeight: active ? '600' : '400' }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {mode === 'loopback' ? <LoopbackLab /> : <CrossDeviceLab />}
    </View>
  );
}
