/**
 * Nostr Bridge Lab — projects the local DAG HEAD into a NIP-78 kind
 * 30078 event, publishes to a developer-entered relay, and subscribes
 * with the `#d=solidarity-dag-v1` filter. Per docs §3.4.
 *
 * §13.1 / §13.2: no default relay list, no auto-fill, no persistence
 * across app restarts. The developer pastes the URL each session;
 * helper text below the input names two public options and the
 * privacy cost.
 *
 * Round-trip test: opens a subscription, waits for EOSE, publishes the
 * HEAD event, measures the time to first matching echo. Closes the
 * subscription after either echo or timeout.
 *
 * What's intentionally NOT here: ingesting received events into the
 * local DAG. NIP-78 30078 is a HEAD pointer, not an immutable node;
 * the §3.3 sync protocol is what actually transfers DAG nodes.
 */
import { Stack } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  NIP78_D_TAG,
  type NostrEvent,
  type SubscriptionHandle,
  buildHeadPointerEvent,
  publishEvent,
  subscribeEvents,
  verifyNostrEvent,
} from '@/dag/nostrAdapter';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { usePreferences } from '@/settings/preferences';

const LOG_MAX = 40;
const ROUNDTRIP_TIMEOUT_MS = 15_000;

interface LogEntry {
  readonly ts: number;
  readonly kind: 'publish' | 'event' | 'eose' | 'error' | 'info';
  readonly text: string;
}

// Hoisted to a stable ref — inline `options={{ presentation: 'modal' }}` is a
// new object each render → expo-router setOptions loop → "Maximum update depth".
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;

export default function NostrBridgeLab() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const [devPubkey, setDevPubkey] = useState<string>('');
  const [headCount, setHeadCount] = useState(0);
  const [relayUrl, setRelayUrl] = useState('');
  const [logs, setLogs] = useState<readonly LogEntry[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState<null | 'publish' | 'subscribe' | 'roundtrip'>(null);
  const subRef = useRef<SubscriptionHandle | null>(null);

  useEffect(() => {
    if (!developerMode) return;
    try {
      setDevPubkey(loadOrCreateDevKey().pubkeyHex);
    } catch {
      setDevPubkey('');
    }
    try {
      setHeadCount(getDagStore().heads().length);
    } catch {
      setHeadCount(0);
    }
    return () => {
      subRef.current?.close();
      subRef.current = null;
    };
  }, [developerMode]);

  const appendLog = useCallback((kind: LogEntry['kind'], text: string) => {
    setLogs((cur) => [{ ts: Date.now(), kind, text }, ...cur].slice(0, LOG_MAX));
  }, []);

  const publishHead = useCallback(async () => {
    if (!relayUrl) {
      pushToast('Enter a relay URL first', 'warning', 2000);
      return;
    }
    if (busy) return;
    setBusy('publish');
    try {
      const { privkey, pubkeyHex } = loadOrCreateDevKey();
      const heads = getDagStore().heads();
      const event = buildHeadPointerEvent(privkey, pubkeyHex, heads);
      appendLog('publish', `→ EVENT kind=30078 d=${NIP78_D_TAG} heads=${String(heads.length)} id=${event.id.slice(0, 12)}…`);
      const result = await publishEvent(relayUrl, event);
      appendLog(
        result.accepted ? 'publish' : 'error',
        `← OK accepted=${String(result.accepted)} msg="${result.message}" (${result.elapsedMs.toFixed(0)}ms)`
      );
      if (result.accepted) {
        haptic('success');
        pushToast('HEAD published', 'success', 2000);
      } else {
        haptic('warning');
        pushToast(`Relay rejected: ${result.message || 'unknown'}`, 'warning', 3000);
      }
    } catch (err) {
      appendLog('error', err instanceof Error ? err.message : 'publish failed');
      haptic('error');
    } finally {
      setBusy(null);
    }
  }, [relayUrl, busy, appendLog]);

  const toggleSubscribe = useCallback(() => {
    if (subscribed) {
      try { subRef.current?.close(); } catch { /* ignore */ }
      subRef.current = null;
      setSubscribed(false);
      appendLog('info', 'subscription closed');
      return;
    }
    if (!relayUrl) {
      pushToast('Enter a relay URL first', 'warning', 2000);
      return;
    }
    setBusy('subscribe');
    try {
      const handle = subscribeEvents(
        relayUrl,
        { kinds: [30078], '#d': [NIP78_D_TAG], limit: 50 },
        (event: NostrEvent) => {
          const ok = verifyNostrEvent(event);
          appendLog(
            'event',
            `${ok ? '✓' : '✗'} ${event.pubkey.slice(0, 12)}… kind=${String(event.kind)} id=${event.id.slice(0, 12)}…`
          );
        },
        () => { appendLog('eose', 'EOSE — switching to live'); },
        (errMsg) => { appendLog('error', errMsg); }
      );
      subRef.current = handle;
      setSubscribed(true);
      appendLog('info', `→ REQ ${handle.subscriptionId} kinds=[30078] #d=[${NIP78_D_TAG}]`);
    } catch (err) {
      appendLog('error', err instanceof Error ? err.message : 'subscribe failed');
    } finally {
      setBusy(null);
    }
  }, [subscribed, relayUrl, appendLog]);

  const runRoundtrip = useCallback(async () => {
    if (!relayUrl) {
      pushToast('Enter a relay URL first', 'warning', 2000);
      return;
    }
    if (busy) return;
    setBusy('roundtrip');
    // Close any existing subscription first.
    try { subRef.current?.close(); } catch { /* ignore */ }
    subRef.current = null;
    setSubscribed(false);

    const { privkey, pubkeyHex } = loadOrCreateDevKey();
    const heads = getDagStore().heads();
    const event = buildHeadPointerEvent(privkey, pubkeyHex, heads);
    appendLog('info', `roundtrip · id=${event.id.slice(0, 12)}…`);

    let echoSeenAt = 0;
    let eoseSeenAt = 0;
    const started = performance.now();
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });

    const handle = subscribeEvents(
      relayUrl,
      { kinds: [30078], '#d': [NIP78_D_TAG], authors: [pubkeyHex], limit: 0 },
      (incoming: NostrEvent) => {
        if (incoming.id === event.id) {
          echoSeenAt = performance.now() - started;
          appendLog('event', `↩ ECHO id=${incoming.id.slice(0, 12)}… (${echoSeenAt.toFixed(0)}ms)`);
          resolveDone?.();
        }
      },
      () => {
        eoseSeenAt = performance.now() - started;
        appendLog('eose', `EOSE (${eoseSeenAt.toFixed(0)}ms) — publishing now`);
        void publishEvent(relayUrl, event).then((res) => {
          appendLog('publish', `← OK accepted=${String(res.accepted)} (${res.elapsedMs.toFixed(0)}ms total)`);
          if (!res.accepted) {
            appendLog('error', `relay rejected — echo will not arrive`);
            resolveDone?.();
          }
        }).catch((err: unknown) => {
          appendLog('error', err instanceof Error ? err.message : 'publish failed');
          resolveDone?.();
        });
      },
      (errMsg) => { appendLog('error', `sub: ${errMsg}`); }
    );

    const timeout = setTimeout(() => {
      appendLog('error', `roundtrip timeout after ${String(ROUNDTRIP_TIMEOUT_MS)}ms`);
      resolveDone?.();
    }, ROUNDTRIP_TIMEOUT_MS);

    try {
      await done;
    } finally {
      clearTimeout(timeout);
      try { handle.close(); } catch { /* ignore */ }
      setBusy(null);
      if (echoSeenAt > 0) {
        haptic('success');
        pushToast(`Roundtrip · ${echoSeenAt.toFixed(0)}ms`, 'success', 2500);
      }
    }
  }, [relayUrl, busy, appendLog]);

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { safeBack(); }} />
        <SettingsScreenTitle title="Nostr Bridge" />
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
      <SettingsBackToolbar title="Close" onPress={() => { safeBack(); }} />
      <SettingsScreenTitle title="Nostr Bridge" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              Projects this device&#39;s sandbox key onto Nostr. Publishes the DAG HEAD as a NIP-78 kind 30078 event (replaceable per `d` tag). Subscribes with the same filter to receive other devices&#39; HEAD pointers.
            </Text>
          </View>

          <SettingsBlockSection
            title="Sandbox key"
            footer="secp256k1 (BIP-340). Same key the DAG Lab signs nodes with. Production Spruce ed25519 DID is untouched."
          >
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text className="text-text3 text-[11px]" style={{ marginBottom: 4 }}>
                PUBKEY (x-only hex)
              </Text>
              <Text
                className="text-text1 text-[11px]"
                style={{ fontFamily: 'Menlo' }}
                numberOfLines={2}
                selectable
              >
                {devPubkey || '(generating…)'}
              </Text>
              <Text className="text-text3 text-[11px]" style={{ marginTop: 8 }}>
                {`Current local HEADs: ${String(headCount)}`}
              </Text>
            </View>
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Relay"
            footer={
              'Free public relays: wss://relay.damus.io, wss://nos.lol. Your DAG HEAD becomes visible to that operator. Never persisted across app restarts (§13.2).'
            }
          >
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <TextInput
                value={relayUrl}
                onChangeText={setRelayUrl}
                placeholder="wss://relay.damus.io"
                placeholderTextColor={Colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={{ color: Colors.text1, fontSize: 13, fontFamily: 'Menlo' }}
              />
            </View>
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Actions"
            footer={
              busy === 'publish'
                ? 'Publishing…'
                : busy === 'subscribe'
                  ? 'Subscribing…'
                  : busy === 'roundtrip'
                    ? 'Roundtrip running…'
                    : 'Publish wraps current HEAD as kind=30078. Subscribe streams matching events live. Roundtrip publishes + waits for the echo from the same relay.'
            }
          >
            <SettingsBlockRow
              icon="paperplane"
              title="Publish HEAD"
              subtitle={`Wraps ${String(headCount)} HEAD${headCount === 1 ? '' : 's'} as a NIP-78 event`}
              onPress={() => { void publishHead(); }}
            />
            <SettingsBlockRow
              icon={subscribed ? 'antenna.radiowaves.left.and.right' : 'antenna.radiowaves.left.and.right.slash'}
              title={subscribed ? 'Unsubscribe' : 'Subscribe to solidarity-dag-v1'}
              subtitle={subscribed ? 'Active — incoming events appear below' : 'Filter: kinds=[30078] #d=[solidarity-dag-v1]'}
              onPress={toggleSubscribe}
            />
            <SettingsBlockRow
              icon="arrow.uturn.right.circle"
              title="Roundtrip test (publish + wait for echo)"
              subtitle={`Timeout ${String(ROUNDTRIP_TIMEOUT_MS / 1000)}s`}
              onPress={() => { void runRoundtrip(); }}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`Log (last ${String(Math.min(logs.length, LOG_MAX))})`}
              </Text>
            </View>
            <View className="px-4 gap-1">
              {logs.length === 0 ? (
                <Text className="text-text3 text-[12px]">No traffic yet.</Text>
              ) : (
                logs.map((entry) => (
                  <View
                    key={`${String(entry.ts)}-${entry.text.slice(0, 16)}`}
                    className="bg-mutedSurface rounded-md"
                    style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text
                      className="text-text1 text-[11px]"
                      style={{
                        fontFamily: 'Menlo',
                        color: entry.kind === 'error'
                          ? Colors.destructive
                          : entry.kind === 'event'
                            ? Colors.terminalGreen
                            : Colors.text1,
                      }}
                      numberOfLines={3}
                    >
                      {entry.text}
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
