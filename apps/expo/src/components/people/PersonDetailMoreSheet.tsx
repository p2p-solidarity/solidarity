/**
 * PersonDetailMoreSheet — 1:1 port of
 * solidarity/Views/PeopleViews/PersonDetailMoreSheet.swift.
 *
 * "More" sheet presented from the Person detail hero edit pencil. Contains:
 *   • chevron.left back + dark "Done" pill in the top bar
 *   • "Note" 14pt label + 48pt searchBg input (placeholder "Add text")
 *   • Destructive "Delete Contact" row (rgba destructive @ 10% fill,
 *     destructive text), tapping triggers a confirm Alert.
 *
 * Wrapped in a slide-in RN `Modal` so it doesn't push the navigation stack.
 */
import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { confirmDialog } from '@/feedback/confirmDialog';
import type { Contact } from '@solidarity/shared';

export interface PersonDetailMoreSheetProps {
  readonly visible: boolean;
  readonly contact: Contact;
  /** Persist the updated note body. Called when the user taps "Done". */
  readonly onSave: (note: string) => void;
  /** Delete the contact. Called after the user confirms. */
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

export function PersonDetailMoreSheet({
  visible,
  contact,
  onSave,
  onDelete,
  onClose,
}: PersonDetailMoreSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <PersonDetailMoreSheetContent
        contact={contact}
        onSave={onSave}
        onDelete={onDelete}
        onClose={onClose}
      />
    </Modal>
  );
}

function PersonDetailMoreSheetContent({
  contact,
  onSave,
  onDelete,
  onClose,
}: {
  readonly contact: Contact;
  readonly onSave: (note: string) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [noteDraft, setNoteDraft] = useState<string>(contact.notes ?? '');

  const handleDone = (): void => {
    onSave(noteDraft);
    onClose();
  };

  const handleDelete = (): void => {
    void (async () => {
      const ok = await confirmDialog({
        title: `Delete ${contact.businessCard.name}?`,
        message: 'This contact will be permanently removed.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      onDelete();
      onClose();
    })();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: Colors.pageBg }}
    >
      <View style={{ paddingTop: insets.top }}>
        <TopBar onClose={onClose} onDone={handleDone} />
      </View>

      <View
        className="flex-1"
        style={{ paddingHorizontal: 16, paddingTop: 12, rowGap: 32 }}
      >
        <NoteBlock value={noteDraft} onChange={setNoteDraft} />
        <DeleteButton onPress={handleDelete} />
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top bar — chevron.left back + dark "Done" pill (invertedButton colours)
// ─────────────────────────────────────────────────────────────────────────────

function TopBar({
  onClose,
  onDone,
}: {
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactNode {
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, height: 56 }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} hitSlop={8}>
        <SfIcon name="chevron.left" size={24} color={Colors.text1} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={onDone}
        className="rounded-sm2 active:opacity-80"
        style={{
          backgroundColor: Colors.invertedButtonBg,
          paddingHorizontal: 16,
          paddingVertical: 4,
        }}
      >
        <Text
          style={{
            color: Colors.invertedButtonText,
            fontSize: 13,
            fontWeight: '500',
          }}
        >
          Done
        </Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Note block — 14pt textPrimary label + 48pt searchBg input (1pt @ 50% border)
// ─────────────────────────────────────────────────────────────────────────────

function NoteBlock({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): ReactNode {
  return (
    <View style={{ rowGap: 8 }}>
      <Text className="text-text1" style={{ fontSize: 14 }}>
        Note
      </Text>
      <View
        className="bg-searchBg rounded-sm2"
        style={{
          height: 48,
          paddingHorizontal: 12,
          justifyContent: 'center',
          borderWidth: 0.5,
          borderColor: `${Colors.text2}80`,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Add text"
          placeholderTextColor={Colors.text3}
          className="text-text1"
          style={{ fontSize: 15, padding: 0 }}
        />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete button — destructive text on destructive@10% fill, 48pt tall
// ─────────────────────────────────────────────────────────────────────────────

function DeleteButton({ onPress }: { readonly onPress: () => void }): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Delete Contact"
      className="rounded-sm2 active:opacity-80"
      style={{
        height: 48,
        backgroundColor: `${Colors.destructive}1A`,
        paddingHorizontal: 12,
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: Colors.destructive, fontSize: 15 }}>Delete Contact</Text>
    </Pressable>
  );
}
