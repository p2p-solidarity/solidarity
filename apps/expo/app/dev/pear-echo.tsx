/**
 * Pear Echo — A3.1 smoke test only. Proves `react-native-bare-kit`'s
 * TurboModule links and a Bare worklet actually runs: starts an
 * inline-source worklet that echoes IPC bytes back verbatim, and
 * round-trips one message. No protocol/lane code here — that's A3.2+.
 *
 * Gated by Developer Mode like every sibling `/dev/*` lab (see dag.tsx,
 * p2p.tsx) so direct/deep-link navigation can't bypass the hub's gating.
 *
 * Worklet lifecycle: held in a ref (not a local var) so unmount can
 * terminate a live worklet — otherwise navigating away mid-run orphans
 * the Bare runtime. `start()`/`IPC.write()` are wrapped in try/catch, and
 * a 10s timeout terminates + surfaces an honest error if no reply ever
 * arrives, so `busy` can never stick on "Running…" forever.
 */
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Worklet } from 'react-native-bare-kit';
import b4a from 'b4a';

import { SettingsBackToolbar, SettingsBlockRow, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

const ECHO_SOURCE = "const { IPC } = BareKit\nIPC.on('data', (data) => IPC.write(data))";
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;
const ECHO_TIMEOUT_MS = 10_000;

type EchoState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'reply'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string };

export default function PearEcho() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const [state, setState] = useState<EchoState>({ kind: 'idle' });
  const workletRef = useRef<Worklet | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Terminates any live worklet + pending timeout. Safe to call more than
  // once (idempotent) — used both mid-run (settle) and on unmount.
  const teardown = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (workletRef.current) {
      try {
        workletRef.current.terminate();
      } catch {
        // Already dead — nothing left to clean up.
      }
      workletRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const runEcho = useCallback(() => {
    teardown();
    setState({ kind: 'running' });
    try {
      const worklet = new Worklet();
      workletRef.current = worklet;
      worklet.start('/app.js', ECHO_SOURCE);
      worklet.IPC.once('data', (data: Uint8Array) => {
        teardown();
        if (!mountedRef.current) return;
        setState({ kind: 'reply', text: b4a.toString(data) });
      });
      worklet.IPC.write(b4a.from('pear-echo-smoke'));
      timeoutRef.current = setTimeout(() => {
        teardown();
        if (!mountedRef.current) return;
        setState({ kind: 'error', message: t('developer.pear.timeoutError') });
      }, ECHO_TIMEOUT_MS);
    } catch (err) {
      teardown();
      setState({
        kind: 'error',
        message: t('developer.pear.runError', {
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  }, [t, teardown]);

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title="Pear Echo" />
        <View className="px-4 pt-6">
          <Text className="text-text2 text-[13px]">
            Sandbox is gated by Developer Mode. Toggle it in Settings ▸ Developer first.
          </Text>
        </View>
      </View>
    );
  }

  const busy = state.kind === 'running';
  const title = busy ? 'Running…' : 'Run echo';
  const subtitle =
    state.kind === 'reply'
      ? `Received: ${state.text}`
      : state.kind === 'error'
        ? state.message
        : 'No reply yet';

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Pear Echo" />
      <View className="px-4 pt-4 gap-4">
        <Text className="text-text2 text-[13px]">
          Starts a Bare worklet from an inline source string and round-trips one IPC message. Proves the bare-kit TurboModule + worklet runtime link natively.
        </Text>
        <SettingsBlockRow
          icon="waveform"
          title={title}
          subtitle={subtitle}
          onPress={runEcho}
        />
      </View>
    </View>
  );
}
