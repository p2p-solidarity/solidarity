import type { ReactNode } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

interface WindowOverlayProps {
  readonly visible: boolean;
  readonly onRequestClose: () => void;
  readonly children: ReactNode;
}

/**
 * Hosts an imperative app-wide overlay above every navigation screen and
 * native sheet.
 *
 * A root-level React Native `Modal` cannot reliably present while an iOS
 * `formSheet` / `pageSheet` modal is already being presented. In that state
 * the request exists in JS but its confirmation or consent UI can be hidden,
 * making the triggering control appear dead. `FullWindowOverlay` attaches
 * directly below the active UIWindow and therefore remains visible above an
 * already-presented native sheet. Android keeps the native Modal host, where
 * separate dialog windows stack correctly.
 */
export function WindowOverlay({
  visible,
  onRequestClose,
  children,
}: WindowOverlayProps): ReactNode {
  if (!visible) return null;

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onRequestClose}
          style={StyleSheet.absoluteFill}
        >
          {children}
        </View>
      </FullWindowOverlay>
    );
  }

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      {children}
    </Modal>
  );
}
