/**
 * Pear Echo — A3.1 smoke test only. Proves `react-native-bare-kit`'s
 * TurboModule links and a Bare worklet actually runs: starts an
 * inline-source worklet that echoes IPC bytes back verbatim, and
 * round-trips one message. No protocol/lane code here — that's A3.2+.
 */
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Worklet } from 'react-native-bare-kit';
import b4a from 'b4a';

import { SettingsBackToolbar, SettingsBlockRow, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';

const ECHO_SOURCE = "const { IPC } = BareKit\nIPC.on('data', (data) => IPC.write(data))";
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;

export default function PearEcho() {
  const insets = useSafeAreaInsets();
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runEcho = useCallback(() => {
    setBusy(true);
    const worklet = new Worklet();
    worklet.start('/app.js', ECHO_SOURCE);
    worklet.IPC.once('data', (data: Uint8Array) => {
      setReply(b4a.toString(data));
      setBusy(false);
      worklet.terminate();
    });
    worklet.IPC.write(b4a.from('pear-echo-smoke'));
  }, []);

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
          title={busy ? 'Running…' : 'Run echo'}
          subtitle={reply ? `Received: ${reply}` : 'No reply yet'}
          onPress={runEcho}
        />
      </View>
    </View>
  );
}
