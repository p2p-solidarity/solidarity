/**
 * GroupJoinSheet — 1:1 port of Swift GroupJoinSheet
 *   (solidarity/Views/IDViews/GroupJoinSheet.swift).
 *
 * Modal sheet with:
 *   • Nav title "Join Group" (inline) + leading Cancel
 *   • INVITE TOKEN section: TextField + helper text ("Enter the token shared
 *     with you to join a private or public group.")
 *   • Optional error / success blocks (searchBg + colored stroke)
 *   • Join Group primary button (disabled until token non-empty + while
 *     joining), with inline ActivityIndicator when joining.
 *   • Scan QR Code secondary button → /scan
 *
 * TODO(android): the actual join still relies on CloudKitGroupSyncManager.
 * The current handler accepts both bare tokens and full deep-link URLs
 * (`solidarity://group/<token>` or `airmeishi://...?token=...`) and routes
 * the token through the local store so the visual contract is preserved.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { IDSectionHeader } from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { extractShareTarget, syncManager } from '@/groups/cloudSync';

const MONO_FONT = 'Menlo';

function extractToken(raw: string): string {
  // Mirrors the Swift handleScannedCode logic. We re-use the shared
  // `extractShareTarget` so the same parsing applies whether the input is
  // a CKShare URL, a Drive webViewLink, a custom-scheme deep link, or a
  // bare token.
  return extractShareTarget(raw);
}

export interface GroupJoinSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function GroupJoinSheet({
  visible,
  onClose,
}: GroupJoinSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const reset = (): void => {
    setToken('');
    setIsJoining(false);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const closeAndReset = (): void => {
    reset();
    onClose();
  };

  const onJoin = async (): Promise<void> => {
    const trimmed = token.trim();
    if (trimmed.length === 0) return;
    setIsJoining(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      // CloudKit / Drive share acceptance via the Nitro module. The
      // returned shareId is the handle the local store + Sakura messaging
      // uses to refer back to the joined group.
      const shareId = await syncManager().joinGroup(trimmed);
      setSuccessMessage(`Successfully joined ${shareId}!`);
      pushToast(`Joined ${shareId}`, 'success');
      setTimeout(() => { closeAndReset(); }, 1500);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setErrorMessage(`Failed to join: ${message}`);
    } finally {
      setIsJoining(false);
    }
  };

  const onScan = (): void => {
    onClose();
    router.push('/scan');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeAndReset}
    >
      <View className="flex-1 bg-pageBg">
        <View style={{ paddingTop: insets.top }} className="bg-pageBg">
          <View className="h-11 flex-row items-center px-4">
            <PressableScale
              onPress={closeAndReset}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
              className="px-1 py-1"
            >
              <Text className="text-text1 text-[16px]">Cancel</Text>
            </PressableScale>
            <View className="flex-1 items-center">
              <Text className="text-text1 text-[17px] font-semibold">
                Join Group
              </Text>
            </View>
            <View style={{ width: 60 }} />
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-4">
            <View>
              <View className="pb-2">
                <IDSectionHeader title="INVITE TOKEN" />
              </View>
              <View
                style={{ borderWidth: 1, borderColor: Colors.divider }}
                className="overflow-hidden"
              >
                <TextInput
                  value={token}
                  onChangeText={(t) => { setToken(extractToken(t)); }}
                  placeholder="Enter Invite Token"
                  placeholderTextColor={Colors.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="bg-searchBg text-text1 text-[14px] px-4 py-4"
                />
              </View>
              <Text
                style={{ fontFamily: MONO_FONT }}
                className="text-text3 text-[12px] pt-1.5"
              >
                Enter the token shared with you to join a private or public group.
              </Text>
            </View>

            {errorMessage ? (
              <View
                className="bg-searchBg"
                style={{
                  padding: 16,
                  borderWidth: 1,
                  borderColor: `${Colors.destructive}4D`,
                }}
              >
                <Text className="text-destructive text-[14px]">
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {successMessage ? (
              <View
                className="bg-searchBg"
                style={{
                  padding: 16,
                  borderWidth: 1,
                  borderColor: `${Colors.terminalGreen}4D`,
                }}
              >
                <Text
                  style={{ color: Colors.terminalGreen }}
                  className="text-[14px]"
                >
                  {successMessage}
                </Text>
              </View>
            ) : null}

            <ThemedButton
              variant="primary"
              label={isJoining ? 'Joining...' : 'Join Group'}
              fullWidth
              disabled={token.trim().length === 0 || isJoining}
              leadingIcon={
                isJoining ? <ActivityIndicator color="#FFFFFF" /> : undefined
              }
              onPress={() => { void onJoin(); }}
            />

            <ThemedButton
              variant="secondary"
              label="Scan QR Code"
              fullWidth
              leadingIcon={
                <SfIcon
                  name="qrcode.viewfinder"
                  size={14}
                  color={Colors.accentRose}
                />
              }
              onPress={onScan}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
