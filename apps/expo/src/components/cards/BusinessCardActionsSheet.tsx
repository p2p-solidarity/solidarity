/**
 * BusinessCardActionsSheet — bottom-sheet for card row actions.
 *
 * Distilled from
 * solidarity/Views/CardViews/BusinessCardActionsView.swift (WalletCardView
 * action buttons + Swift `.confirmationDialog` choices on the card list
 * screen). Actions: Edit / Wallet Pass / Share / Delete (destructive).
 *
 * Modal frame + Pressable backdrop mirror ManualContactEntrySheet so
 * dismiss feel matches the rest of the app.
 */
import type { ReactNode } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import type { BusinessCard } from '@solidarity/shared';

export interface BusinessCardActionsSheetProps {
  readonly visible: boolean;
  readonly card: BusinessCard | undefined;
  readonly onClose: () => void;
  readonly onEdit: (card: BusinessCard) => void;
  readonly onWalletPass: (card: BusinessCard) => void;
  readonly onShare: (card: BusinessCard) => void;
  readonly onDelete: (card: BusinessCard) => void;
}

export function BusinessCardActionsSheet({
  visible,
  card,
  onClose,
  onEdit,
  onWalletPass,
  onShare,
  onDelete,
}: BusinessCardActionsSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: Colors.overlayBg, justifyContent: 'flex-end' }}
      >
        <Pressable onPress={() => undefined}>
          {card ? (
            <SheetBody
              card={card}
              onClose={onClose}
              onEdit={onEdit}
              onWalletPass={onWalletPass}
              onShare={onShare}
              onDelete={onDelete}
            />
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetBody({
  card,
  onClose,
  onEdit,
  onWalletPass,
  onShare,
  onDelete,
}: {
  readonly card: BusinessCard;
  readonly onClose: () => void;
  readonly onEdit: (card: BusinessCard) => void;
  readonly onWalletPass: (card: BusinessCard) => void;
  readonly onShare: (card: BusinessCard) => void;
  readonly onDelete: (card: BusinessCard) => void;
}): ReactNode {
  const insets = useSafeAreaInsets();

  const handleDeletePress = (): void => {
    Alert.alert(
      `Delete ${card.name}?`,
      'This card will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptic('warning');
            onDelete(card);
            onClose();
          },
        },
      ],
    );
  };

  const wrap = (run: () => void): (() => void) => () => {
    haptic('selection');
    run();
    onClose();
  };

  return (
    <View
      className="bg-cardBg"
      style={{
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 12,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 16,
        rowGap: 4,
      }}
    >
      <Handle />

      <ThemedText
        variant="caption"
        tone="tertiary"
        style={{ paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 }}
        numberOfLines={1}
      >
        {card.name}
      </ThemedText>

      <ActionRow icon="square.and.pencil" label="Edit" onPress={wrap(() => { onEdit(card); })} />
      <ActionRow icon="wallet.pass" label="Wallet Pass" onPress={wrap(() => { onWalletPass(card); })} />
      <ActionRow icon="square.and.arrow.up" label="Share" onPress={wrap(() => { onShare(card); })} />
      <ActionRow
        icon="trash"
        label="Delete"
        destructive
        onPress={handleDeletePress}
      />
    </View>
  );
}

function Handle(): ReactNode {
  return (
    <View style={{ alignItems: 'center', paddingBottom: 8 }}>
      <View
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: Colors.divider,
        }}
      />
    </View>
  );
}

function ActionRow({
  icon,
  label,
  destructive = false,
  onPress,
}: {
  readonly icon: Parameters<typeof SfIcon>[0]['name'];
  readonly label: string;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const tint = destructive ? Colors.destructive : Colors.text1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="active:opacity-70"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 52,
        columnGap: 14,
        paddingHorizontal: 8,
      }}
    >
      <View style={{ width: 24, alignItems: 'center' }}>
        <SfIcon name={icon} size={18} color={tint} />
      </View>
      <ThemedText
        variant="bodyLarge"
        tone={destructive ? 'error' : 'primary'}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}
