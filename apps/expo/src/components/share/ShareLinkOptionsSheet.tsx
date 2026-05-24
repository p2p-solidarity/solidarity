/**
 * ShareLinkOptionsSheet — bottom-sheet "Share via…" picker.
 *
 * Wraps the platform-native share affordances around a single URL or QR
 * payload. Mirrors the Swift UIActivityViewController options surfaced
 * from MatchViews/ShareLinkOptionsView (Copy link / Open in browser /
 * AirDrop iOS-only / QR code / More…). The QR-code action is a no-op
 * hook surfaced via `onShowQr` so the host screen can flip its own
 * inline QR preview.
 */
import type { SFSymbol } from 'expo-symbols';
import { type ReactNode } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';

export interface ShareLinkOptionsSheetProps {
  readonly visible: boolean;
  readonly url: string;
  readonly title?: string;
  readonly onClose: () => void;
  readonly onShowQr?: () => void;
}

export function ShareLinkOptionsSheet({
  visible,
  url,
  title,
  onClose,
  onShowQr,
}: ShareLinkOptionsSheetProps): ReactNode {
  const insets = useSafeAreaInsets();

  const copy = async (): Promise<void> => {
    haptic('success');
    await Clipboard.setStringAsync(url);
    pushToast('Link copied to clipboard.', 'success');
    onClose();
  };

  const openInBrowser = async (): Promise<void> => {
    haptic('tap');
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      pushToast('Cannot open this URL.', 'warning');
      return;
    }
    await Linking.openURL(url);
    onClose();
  };

  const airdrop = async (): Promise<void> => {
    haptic('tap');
    // Share API on iOS routes through UIActivityViewController, which is
    // the same surface AirDrop lives on. Force the native sheet so the
    // user can pick AirDrop explicitly.
    await Share.share({ url, message: url, title });
    onClose();
  };

  const showQr = (): void => {
    haptic('selection');
    onShowQr?.();
    onClose();
  };

  const more = async (): Promise<void> => {
    haptic('tap');
    await Share.share({ url, message: url, title });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => { /* swallow taps inside */ }}
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.grabber} />
          <ThemedText
            variant="titleMedium"
            style={{ textAlign: 'center', paddingBottom: 8 }}
          >
            Share via…
          </ThemedText>

          <OptionRow
            icon="doc.on.doc"
            label="Copy link"
            onPress={() => { void copy(); }}
          />
          <OptionRow
            icon="safari"
            label="Open in browser"
            onPress={() => { void openInBrowser(); }}
          />
          {Platform.OS === 'ios' ? (
            <OptionRow
              icon="airplayaudio"
              label="AirDrop"
              onPress={() => { void airdrop(); }}
            />
          ) : null}
          {onShowQr ? (
            <OptionRow icon="qrcode" label="QR code" onPress={showQr} />
          ) : null}
          <OptionRow
            icon="ellipsis.circle"
            label="More…"
            onPress={() => { void more(); }}
          />

          <View style={{ height: 12 }} />
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.cancelRow}
          >
            <ThemedText variant="bodyLarge" tone="accent">
              Cancel
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OptionRow({
  icon,
  label,
  onPress,
}: {
  readonly icon: SFSymbol;
  readonly label: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, pressed ? styles.optionPressed : null]}
    >
      <View style={styles.optionIcon}>
        <SfIcon name={icon} size={18} color={Colors.text1} />
      </View>
      <ThemedText variant="bodyLarge">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayBg,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.popupSurface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 4,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.divider,
    alignSelf: 'center',
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  optionPressed: {
    backgroundColor: Colors.mutedSurface,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.searchBg,
  },
  cancelRow: {
    paddingVertical: 14,
    alignItems: 'center',
  },
});
