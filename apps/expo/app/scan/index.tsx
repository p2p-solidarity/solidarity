/**
 * Scan screen — wraps QrScanner and routes results into the appropriate
 * handler (plaintext card / signed JWT / OIDC request / group invite).
 *
 * Mirrors Swift ScanRouterService dispatch. The router lives at
 * src/scan/router.ts (Phase 4.1 follow-up); here we render the result
 * directly until the router lands.
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { QrScanner } from '@/scan/QrScanner';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function ScanScreen() {
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);

  const onResult = useCallback((payload: string) => {
    setResult(payload);
    setProgress(null);
  }, []);

  const onProgress = useCallback((received: number, total: number) => {
    setProgress({ received, total });
  }, []);

  if (result) {
    return (
      <View className="flex-1 bg-pageBg p-6 justify-between">
        <View>
          <ThemedText variant="headlineMedium">Scanned</ThemedText>
          <ThemedSurface variant="card" padded className="mt-4">
            <ThemedText variant="bodySmall" numberOfLines={6} selectable>
              {result}
            </ThemedText>
          </ThemedSurface>
        </View>
        <View>
          <ThemedButton label="Scan another" fullWidth onPress={() => setResult(null)} />
          <View className="mt-2">
            <ThemedButton
              variant="secondary"
              label="Close"
              fullWidth
              onPress={() => router.back()}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <QrScanner onResult={onResult} onProgress={onProgress} />
      {progress ? (
        <View className="absolute bottom-10 left-0 right-0 items-center">
          <ThemedSurface variant="elevated" padded className="mx-6">
            <ThemedText variant="caption" tone="secondary">
              Receiving {String(progress.received)} / {String(progress.total)}…
            </ThemedText>
          </ThemedSurface>
        </View>
      ) : null}
    </View>
  );
}
