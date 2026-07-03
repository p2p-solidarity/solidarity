/**
 * Pear Lane Lab — A3.2 loopback: two Bare worklets spawned in-process
 * (each its own `startLane()` -> its own hyperswarm instance), both
 * `joinTopic()` the same topic, and exchange one JSON frame + reply
 * through the real relay path — RN(A) -> worklet(A) -> Noise socket ->
 * worklet(B) -> RN(B), and back. No challenge/response, no card protocol:
 * that's A3.3/A5, entirely RN-side. This proves the mechanical pipe.
 *
 * HONESTY NOTE (apps/expo/CLAUDE.md "No fake data" + this task's
 * verification requirement): `swarm.join()` needs real DHT bootstrap
 * (UDP egress). On a network that blocks it (sandboxed CI, some
 * corporate/simulator networks), this legitimately times out — the UI
 * must show that as the real `error` state, never a fabricated
 * "connected". There is no synthetic fallback path here.
 *
 * Gated by Developer Mode like every sibling `/dev/*` lab (pear-echo.tsx,
 * dag.tsx, p2p.tsx). Both lanes are held in refs (not locals) so unmount
 * mid-run terminates them — otherwise navigating away orphans two live
 * Bare runtimes each holding a hyperswarm/DHT socket open.
 */
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsBackToolbar, SettingsBlockRow, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { useTranslation } from '@/i18n';
import { pearTopicFor, startLane, type LaneHandle, type PearChannel } from '@/pear/lane';
import { usePreferences } from '@/settings/preferences';

const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;
/** DHT bootstrap + connect + one ping/pong round trip, generously bounded.
 *  Real hyperswarm joins on a healthy network settle in low single-digit
 *  seconds; this only needs to be long enough to distinguish "still
 *  trying" from "genuinely unreachable", not tight. */
const LOOPBACK_TIMEOUT_MS = 30_000;

type LaneLoopbackState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'joining'; readonly topic: string }
  | { readonly kind: 'connected'; readonly topic: string }
  | { readonly kind: 'frame-received'; readonly topic: string; readonly roundTripMs: number; readonly frame: string }
  | { readonly kind: 'error'; readonly message: string };

/** Not security-sensitive — a per-run correlation token for this lab's
 *  topic + ping/pong nonce, not a key or credential. */
function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function PearLaneLab() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const [state, setState] = useState<LaneLoopbackState>({ kind: 'idle' });

  const laneARef = useRef<LaneHandle | null>(null);
  const laneBRef = useRef<LaneHandle | null>(null);
  const unsubscribersRef = useRef<(() => void)[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Terminates both lanes + drops listeners + clears the timeout. Safe to
  // call more than once — used both mid-run (settle) and on unmount.
  const teardown = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    for (const unsubscribe of unsubscribersRef.current) unsubscribe();
    unsubscribersRef.current = [];
    for (const laneRef of [laneARef, laneBRef]) {
      if (laneRef.current) {
        try {
          laneRef.current.shutdown();
        } catch {
          // Already dead — nothing left to clean up.
        }
        laneRef.current = null;
      }
    }
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
    setState({ kind: 'joining', topic });

    const laneA = startLane();
    if (!laneA.ok) {
      setState({ kind: 'error', message: t('developer.pearLane.startError', { message: laneA.error.message }) });
      return;
    }
    const laneB = startLane();
    if (!laneB.ok) {
      laneA.value.shutdown();
      setState({ kind: 'error', message: t('developer.pearLane.startError', { message: laneB.error.message }) });
      return;
    }
    laneARef.current = laneA.value;
    laneBRef.current = laneB.value;

    const channelA: PearChannel = laneA.value.joinTopic(topic);
    const channelB: PearChannel = laneB.value.joinTopic(topic);
    const nonce = randomToken();
    const openSides = new Set<'a' | 'b'>();
    let sentAt = 0;

    const tryConnect = (side: 'a' | 'b'): void => {
      openSides.add(side);
      if (openSides.size < 2) return;
      if (mountedRef.current) setState({ kind: 'connected', topic });
      sentAt = Date.now();
      channelA.send({ t: 'dev.ping', nonce, sentAt });
    };

    unsubscribersRef.current = [
      channelA.onCtrl((ev) => {
        if (ev.ev === 'error') {
          settle({ kind: 'error', message: t('developer.pearLane.ctrlError', { side: 'A', message: ev.message }) });
        } else if (ev.ev === 'open') {
          tryConnect('a');
        }
      }),
      channelB.onCtrl((ev) => {
        if (ev.ev === 'error') {
          settle({ kind: 'error', message: t('developer.pearLane.ctrlError', { side: 'B', message: ev.message }) });
        } else if (ev.ev === 'open') {
          tryConnect('b');
        }
      }),
      channelB.onFrame((frame) => {
        if (frame['t'] === 'dev.ping' && frame['nonce'] === nonce) {
          channelB.send({ t: 'dev.pong', nonce, echoedAt: Date.now() });
        }
      }),
      channelA.onFrame((frame) => {
        if (frame['t'] === 'dev.pong' && frame['nonce'] === nonce) {
          settle({
            kind: 'frame-received',
            topic,
            roundTripMs: Date.now() - sentAt,
            frame: JSON.stringify(frame),
          });
        }
      }),
    ];

    timeoutRef.current = setTimeout(() => {
      settle({ kind: 'error', message: t('developer.pearLane.timeoutError') });
    }, LOOPBACK_TIMEOUT_MS);
  }, [settle, t, teardown]);

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

  const busy = state.kind === 'joining' || state.kind === 'connected';
  const rowTitle = busy ? t('developer.pearLane.runningTitle') : t('developer.pearLane.runTitle');
  const rowSubtitle = ((): string => {
    switch (state.kind) {
      case 'idle':
        return t('developer.pearLane.idleSubtitle');
      case 'joining':
        return t('developer.pearLane.joiningSubtitle');
      case 'connected':
        return t('developer.pearLane.connectedSubtitle');
      case 'frame-received':
        return t('developer.pearLane.frameReceivedSubtitle', { ms: state.roundTripMs });
      case 'error':
        return state.message;
    }
  })();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('developer.pearLane.title')} />
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
    </View>
  );
}
