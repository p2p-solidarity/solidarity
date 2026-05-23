/**
 * Scan screen — 1:1 port of Swift ScanTabView. Full-screen camera preview
 * with ScanningFrameView overlay (250×250 white square + 30pt
 * terminalGreen corner indicators), nav bar "Scan" inline + trailing
 * `qrcode` (open self-QR), and a footer SolidarityPlaceholderCard
 * "Protocol Router" showing supported flows.
 *
 * Routes the decoded payload via the scan router.
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ScanningFrameView } from '@/components/scan/ScanningFrameView';
import { SolidarityPlaceholderCard } from '@/components/passport/SolidarityPlaceholderCard';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { QrScanner } from '@/scan/QrScanner';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [isScanning, setIsScanning] = useState(true);

  const onResult = useCallback((payload: string) => {
    setResult(payload);
    setProgress(null);
    setIsScanning(false);
  }, []);

  const onProgress = useCallback((received: number, total: number) => {
    setProgress({ received, total });
  }, []);

  if (result) {
    return <ScannedResultView result={result} onClear={() => { setResult(null); setIsScanning(true); }} />;
  }

  return (
    <View className="flex-1 bg-pageBg">
      <View style={{ position: 'absolute', inset: 0 }}>
        <QrScanner onResult={onResult} onProgress={onProgress} />
      </View>

      <View
        className="flex-row items-center justify-between px-4"
        style={{ height: 44, paddingTop: insets.top }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={{ width: 60, height: 44, justifyContent: 'center' }}
        >
          <Text className="text-text1 text-[15px]">Close</Text>
        </Pressable>
        <Text className="text-text1 text-[17px] font-semibold">Scan</Text>
        <Pressable
          accessibilityRole="button"
          style={{ width: 60, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <SfIcon name="qrcode" size={20} color={Colors.text1} />
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ScanningFrameView />
      </View>

      <View
        style={{ paddingBottom: insets.bottom + 16, paddingHorizontal: 16, gap: 8 }}
      >
        {progress ? (
          <View
            className="rounded-xl bg-mutedSurface px-4 py-3 items-center"
          >
            <Text className="text-text2 text-[13px]">
              {`Receiving ${String(progress.received)} / ${String(progress.total)}…`}
            </Text>
          </View>
        ) : (
          <SolidarityPlaceholderCard
            screenID="SCAN-1"
            title="Protocol Router"
            subtitle="Supports OID4VP request, vp_token verify, credential offers, and SIOPv2."
          />
        )}
        {isScanning ? (
          <View className="flex-row items-center justify-center gap-1.5">
            <ActivityIndicator size="small" />
            <Text className="text-text2 text-[12px]">Scanning...</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ScannedResultView({
  result,
  onClear,
}: {
  result: string;
  onClear: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-pageBg p-6 justify-between"
      style={{ paddingTop: insets.top + 16 }}
    >
      <View>
        <Text className="text-text1 text-[24px] font-medium">Scanned</Text>
        <View className="mt-4 rounded-xl bg-mutedSurface p-4">
          <Text
            selectable
            numberOfLines={6}
            className="text-text2 text-[13px]"
            style={{ fontFamily: 'Menlo' }}
          >
            {result}
          </Text>
        </View>
      </View>
      <View className="gap-2" style={{ paddingBottom: insets.bottom }}>
        <ThemedButton label="Scan another" fullWidth onPress={onClear} />
        <ThemedButton variant="secondary" label="Close" fullWidth onPress={() => router.back()} />
      </View>
    </View>
  );
}
