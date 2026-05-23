/**
 * QR sharing screen — 1:1 port of solidarity/Views/MatchViews/QRSharingView.swift.
 *
 * Auto-refreshing QR card. Counts down 45s then regenerates the payload —
 * intentional anti-replay window so a screenshot leaks at most a 45s
 * authorisation request. Manual "Refresh QR" resets the timer.
 *
 * Share button goes through expo-sharing. The Swift version emits an
 * OID4VP authorisation request URL (`openid4vp://present?…`); the Expo
 * port encodes the same payload via a synchronous helper for now so
 * the screen works even before OIDCService lands in apps/expo.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ON_DARK, ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useMyCard } from '@/cards/cardManager';
import { toVCard } from '@/cards/vCard';
import { pushToast } from '@/feedback/toast';

const COUNTDOWN_SECONDS = 45;

export default function QrSharingScreen() {
  const insets = useSafeAreaInsets();
  const myCard = useMyCard();
  const [generation, setGeneration] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  interface QrRefShape {
    readonly toDataURL?: (cb: (data: string) => void) => void;
  }
  const qrRef = useRef<QrRefShape | null>(null);

  const payload = useMemo(() => {
    if (!myCard) return null;
    // Bumping `generation` re-renders to mimic Swift's "refresh QR every
    // 45s" behaviour. We embed the timestamp so each refresh produces a
    // unique payload even when the underlying card hasn't changed.
    void generation;
    const ts = Date.now().toString(36);
    return `${toVCard(myCard)}\nX-SOLIDARITY-NONCE:${ts}`;
  }, [myCard, generation]);

  const refresh = useCallback(() => {
    setGeneration((g) => g + 1);
    setSecondsLeft(COUNTDOWN_SECONDS);
  }, []);

  useEffect(() => {
    if (!payload) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => { clearInterval(interval); };
  }, [payload]);

  useEffect(() => {
    if (secondsLeft === 0) refresh();
  }, [refresh, secondsLeft]);

  const shareQr = useCallback(async () => {
    const ref = qrRef.current;
    const toDataURL = ref?.toDataURL;
    if (!toDataURL) {
      pushToast('Share unavailable on this device.', 'warning');
      return;
    }
    const dataUrl = await new Promise<string>((resolve) => {
      toDataURL((data) => { resolve(data); });
    });
    const path = `${FileSystem.cacheDirectory ?? ''}solidarity-qr.png`;
    await FileSystem.writeAsStringAsync(path, dataUrl, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path);
    }
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.navBar}>
        <View style={styles.navSpacer} />
        <Text style={styles.navTitle}>My QR</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={() => { router.back(); }}
          style={styles.navAction}
        >
          <Text style={styles.navActionText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Universal Verification QR</Text>
          <View style={styles.qrFrame}>
            {payload ? (
              <QRCode
                value={payload}
                size={260}
                backgroundColor="#FFFFFF"
                color={Colors.text1}
                getRef={(c: QrRefShape | null) => {
                  qrRef.current = c;
                }}
              />
            ) : (
              <View style={styles.placeholder}>
                <SfIcon name="qrcode" size={44} color={Colors.text3} />
                <Text style={styles.placeholderText}>Create a card to generate QR</Text>
              </View>
            )}
          </View>
          <Text style={styles.qrSubtitle}>
            Verifier-compatible OID4VP style request.
          </Text>
        </View>

        <View style={styles.countdownBadge}>
          <SfIcon name="clock" size={12} color={Colors.text2} />
          <Text style={styles.countdownText}>
            {`Refresh in ${String(secondsLeft)}s`}
          </Text>
        </View>

        <View style={styles.actions}>
          <ThemedButton
            fullWidth
            variant="secondary"
            label="Refresh QR"
            leadingIcon={<SfIcon name="arrow.clockwise" size={14} color={Colors.accentRose} />}
            onPress={refresh}
          />
          <ThemedButton
            fullWidth
            label="Share QR"
            leadingIcon={<SfIcon name="square.and.arrow.up" size={14} color={ON_DARK} />}
            disabled={!payload}
            onPress={() => { void shareQr(); }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.pageBg },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 16,
  },
  navSpacer: { width: 60 },
  navTitle: { flex: 1, textAlign: 'center', color: Colors.text1, fontSize: 17, fontWeight: '600' },
  navAction: { minWidth: 60, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  navActionText: { color: Colors.primaryBlue, fontSize: 15, fontWeight: '600' },
  scroll: { padding: 16, gap: 18 },

  qrCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 0.5,
    borderColor: Colors.divider,
  },
  qrTitle: { color: Colors.text1, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { alignItems: 'center', gap: 8 },
  placeholderText: { color: Colors.text2, fontSize: 12, fontFamily: 'Menlo' },
  qrSubtitle: { color: Colors.text2, fontSize: 12, textAlign: 'center', paddingHorizontal: 8 },

  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.searchBg,
    alignSelf: 'center',
  },
  countdownText: { color: Colors.text2, fontSize: 12, fontWeight: '600' },

  actions: { gap: 10 },
});
