/**
 * CloudSharingSheet — cross-platform replacement for
 * solidarity/Views/Common/CloudSharingView.swift (which wraps the
 * iOS-only `UICloudSharingController` over a CKShare).
 *
 * Swift parity strategy:
 *   • iOS  — bridge through `expo-sharing` so the system share sheet
 *            opens for the prepared share URL. Once the Nitro CloudKit
 *            module exposes `presentSharingController`, swap in the
 *            real CKShare flow at the call site.
 *   • Android — no CloudKit. Render an inline notice with copy that
 *            mirrors the Swift form-sheet header and points users to
 *            Settings → Backup for the Drive backup path.
 *
 * Presented as a slide-in Modal so it can be dismissed inline without
 * pushing a route.
 */
import { useState, type ReactNode } from 'react';
import * as Sharing from 'expo-sharing';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';

export interface CloudSharingSheetProps {
  readonly visible: boolean;
  /** Share URL (CloudKit share record URL on iOS). */
  readonly shareUrl?: string;
  /** Display title for the shared item — e.g. group name. */
  readonly itemTitle?: string;
  readonly onDismiss: () => void;
  /** Optional callback when the user taps "Open Backup Settings" on Android. */
  readonly onOpenAndroidBackup?: () => void;
}

export function CloudSharingSheet({
  visible,
  shareUrl,
  itemTitle,
  onDismiss,
  onOpenAndroidBackup,
}: CloudSharingSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onDismiss}
    >
      <CloudSharingContent
        shareUrl={shareUrl}
        itemTitle={itemTitle}
        onDismiss={onDismiss}
        onOpenAndroidBackup={onOpenAndroidBackup}
      />
    </Modal>
  );
}

function CloudSharingContent({
  shareUrl,
  itemTitle,
  onDismiss,
  onOpenAndroidBackup,
}: {
  readonly shareUrl?: string;
  readonly itemTitle?: string;
  readonly onDismiss: () => void;
  readonly onOpenAndroidBackup?: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [sharing, setSharing] = useState(false);

  const isAndroid = Platform.OS === 'android';
  const title = itemTitle ?? 'Group';

  const presentShare = async (): Promise<void> => {
    if (!shareUrl) {
      pushToast('No share link prepared yet.', 'warning');
      return;
    }
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        pushToast('Share sheet not available on this device.', 'warning');
        return;
      }
      await Sharing.shareAsync(shareUrl, { dialogTitle: `Share ${title}` });
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.pageBg, paddingTop: insets.top }}>
      <Toolbar onDone={onDismiss} />

      <ScrollView contentContainerStyle={{ padding: 16, rowGap: 16 }}>
        <View style={{ rowGap: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: Colors.text1 }}>
            Share {title}
          </Text>
          <Text style={{ fontSize: 15, color: Colors.text2, lineHeight: 22 }}>
            {isAndroid
              ? 'Cloud sharing unavailable on Android. Use Settings → Backup to export this group to your Google Drive backup.'
              : 'Send a CloudKit invite to people you trust. They will need an Apple ID and an iCloud-signed device to join.'}
          </Text>
        </View>

        {isAndroid ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: Colors.divider,
              borderRadius: 12,
              padding: 16,
              flexDirection: 'row',
              alignItems: 'center',
              columnGap: 12,
              backgroundColor: Colors.cardSurface,
            }}
          >
            <SfIcon name="exclamationmark.triangle" size={20} color={Colors.warning} />
            <Text style={{ fontSize: 14, color: Colors.text2, flex: 1 }}>
              CloudKit is iOS-only. Solidarity for Android backs up via Google Drive instead.
            </Text>
          </View>
        ) : null}

        <View style={{ rowGap: 12, paddingTop: 8 }}>
          {isAndroid ? (
            <ThemedButton
              label="Open Backup Settings"
              variant="primary"
              size="lg"
              fullWidth
              leadingIcon={
                <SfIcon name="gearshape" size={18} color={Colors.cardBg} />
              }
              onPress={() => {
                onOpenAndroidBackup?.();
              }}
              disabled={!onOpenAndroidBackup}
            />
          ) : (
            <ThemedButton
              label="Share with CloudKit"
              variant="primary"
              size="lg"
              fullWidth
              loading={sharing}
              leadingIcon={
                <SfIcon name="square.and.arrow.up" size={18} color={Colors.cardBg} />
              }
              onPress={() => {
                void presentShare();
              }}
            />
          )}

          <ThemedButton
            label="Cancel"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={onDismiss}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Toolbar({ onDone }: { readonly onDone: () => void }): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        height: 44,
      }}
    >
      <View style={{ width: 60 }} />
      <Text style={{ fontSize: 17, fontWeight: '600', color: Colors.text1 }}>
        iCloud Sharing
      </Text>
      <Pressable accessibilityRole="button" onPress={onDone} hitSlop={8}>
        <Text style={{ fontSize: 16, color: Colors.text1, fontWeight: '600' }}>
          Done
        </Text>
      </Pressable>
    </View>
  );
}
