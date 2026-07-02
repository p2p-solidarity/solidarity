/**
 * QR sharing screen — 1:1 port of solidarity/Views/MatchViews/QRSharingView.swift.
 *
 * Auto-refreshing QR card. Counts down 45s then regenerates the payload —
 * intentional anti-replay window so a screenshot leaks at most a 45s
 * authorisation request. Manual "Refresh QR" resets the timer.
 *
 * Share button goes through expo-sharing. The payload is an OID4VP
 * authorisation request URL, matching Swift's OIDCService-backed QR flow.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ShareLinkOptionsSheet } from '@/components/share/ShareLinkOptionsSheet';
import { ON_DARK, ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useMyCard } from '@/cards/cardManager';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { didKeyForCurrentIdentity } from '@/keychain/signingKey';
import { buildOid4VpRequestUrl } from '@/oidc/requestQr';

const COUNTDOWN_SECONDS = 45;

export default function QrSharingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const myCard = useMyCard();
  const [generation, setGeneration] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  interface QrRefShape {
    readonly toDataURL?: (cb: (data: string) => void) => void;
  }
  const qrRef = useRef<QrRefShape | null>(null);
  const [payload, setPayload] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);

    const nonce = randomUUID();
    const state = randomUUID();
    void didKeyForCurrentIdentity()
      .catch(() => 'https://solidarity.gg/oidc/me')
      .then((clientId) =>
        buildOid4VpRequestUrl({
          nonce,
          state,
          clientId,
        })
      )
      .then((next) => {
        if (!cancelled) setPayload(next);
      });

    return () => {
      cancelled = true;
    };
  }, [generation]);

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
      pushToast(t('shareQr.shareUnavailable'), 'warning');
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
        <Text style={styles.navTitle}>{t('shareQr.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('shareQr.done')}
          onPress={() => { router.back(); }}
          style={styles.navAction}
        >
          <Text style={styles.navActionText}>{t('shareQr.done')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>{t('shareQr.cardTitle')}</Text>
          <View style={styles.qrFrame}>
            {payload ? (
              <QRCode
                value={payload}
                size={260}
                backgroundColor="#FFFFFF"
                color="#000000"
                getRef={(c: QrRefShape | null) => {
                  qrRef.current = c;
                }}
              />
            ) : (
              <View style={styles.placeholder}>
                <SfIcon name="qrcode" size={44} color={Colors.text3} />
                <Text style={styles.placeholderText}>{t('shareQr.generating')}</Text>
              </View>
            )}
          </View>
          <Text style={styles.qrSubtitle}>
            {t('shareQr.subtitle')}
          </Text>
        </View>

        <View style={styles.countdownBadge}>
          <SfIcon name="clock" size={12} color={Colors.text2} />
          <Text style={styles.countdownText}>
            {t('shareQr.refreshIn', { seconds: secondsLeft })}
          </Text>
        </View>

        <View style={styles.actions}>
          <ThemedButton
            fullWidth
            variant="secondary"
            label={t('shareQr.refresh')}
            leadingIcon={<SfIcon name="arrow.clockwise" size={14} color={Colors.accentRose} />}
            onPress={refresh}
          />
          <ThemedButton
            fullWidth
            label={t('shareQr.share')}
            leadingIcon={<SfIcon name="square.and.arrow.up" size={14} color={ON_DARK} />}
            disabled={!payload}
            onPress={() => { void shareQr(); }}
          />
          <ThemedButton
            fullWidth
            variant="secondary"
            label={t('shareQr.shareVia')}
            leadingIcon={<SfIcon name="ellipsis.circle" size={14} color={Colors.accentRose} />}
            disabled={!payload}
            onPress={() => { setShareSheetVisible(true); }}
          />
        </View>
      </ScrollView>

      <ShareLinkOptionsSheet
        visible={shareSheetVisible}
        url={payload ?? ''}
        title={myCard?.name}
        onClose={() => { setShareSheetVisible(false); }}
      />
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
  countdownText: { color: Colors.text2, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },

  actions: { gap: 10 },
});
