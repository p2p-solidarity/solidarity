/**
 * PersonDetailMoreSheet — 1:1 port of
 * solidarity/Views/PeopleViews/PersonDetailMoreSheet.swift.
 *
 * "More" sheet presented from the Person detail hero edit pencil. Contains:
 *   • chevron.left back + dark "Done" pill in the top bar
 *   • Note label + 48pt searchBg input (placeholder)
 *   • Destructive "Delete Contact" row (rgba destructive @ 10% fill,
 *     destructive text), tapping triggers a confirm Alert.
 *
 * All user-facing copy routes through i18n (peopleList.* / personDetail.*)
 * so the zh-Hant locale matches Figma (node 723:2397).
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
import { useTranslation } from '@/i18n';
import type { Contact } from '@solidarity/shared';

import type { SFSymbol } from 'expo-symbols';

export interface PersonDetailMoreSheetProps {
  readonly visible: boolean;
  readonly contact: Contact;
  /** Persist the updated note body. Called when the user taps "Done". */
  readonly onSave: (note: string) => void;
  /** Delete the contact. Called after the user confirms. */
  readonly onDelete: () => void;
  /** Open the full Edit Contact sheet. */
  readonly onEditContact: () => void;
  readonly onClose: () => void;
}

export function PersonDetailMoreSheet({
  visible,
  contact,
  onSave,
  onDelete,
  onEditContact,
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
        onEditContact={onEditContact}
        onClose={onClose}
      />
    </Modal>
  );
}

function PersonDetailMoreSheetContent({
  contact,
  onSave,
  onDelete,
  onEditContact,
  onClose,
}: {
  readonly contact: Contact;
  readonly onSave: (note: string) => void;
  readonly onDelete: () => void;
  readonly onEditContact: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [noteDraft, setNoteDraft] = useState<string>(contact.notes ?? '');

  const handleDone = (): void => {
    onSave(noteDraft);
    onClose();
  };

  const handleEditContact = (): void => {
    // Persist the in-flight note so the user doesn't lose what they just
    // typed when they hop to the full editor.
    onSave(noteDraft);
    onClose();
    onEditContact();
  };

  const handleDelete = (): void => {
    void (async () => {
      const ok = await confirmDialog({
        title: t('peopleList.deleteNameTitle', { name: contact.businessCard.name }),
        message: t('peopleList.deleteOneMessage'),
        confirmLabel: t('peopleList.delete'),
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
        style={{ paddingHorizontal: 16, paddingTop: 12, rowGap: 24 }}
      >
        <NoteBlock value={noteDraft} onChange={setNoteDraft} />
        <EditContactButton onPress={handleEditContact} />
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
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, height: 56 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('personDetail.back')}
        onPress={onClose}
        hitSlop={8}
      >
        <SfIcon name="chevron.left" size={24} color={Colors.text1} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('peopleList.done')}
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
          {t('peopleList.done')}
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
  const { t } = useTranslation();
  return (
    <View style={{ rowGap: 8 }}>
      <Text className="text-text1" style={{ fontSize: 14 }}>
        {t('personDetail.noteLabel')}
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
          placeholder={t('personDetail.notePlaceholder')}
          placeholderTextColor={Colors.text3}
          className="text-text1"
          style={{ fontSize: 15, padding: 0 }}
        />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit-contact button — neutral fill, surfaces the full editor sheet for the
// remaining business-card fields (name, title, company, email, phone, tags).
// ─────────────────────────────────────────────────────────────────────────────

function EditContactButton({ onPress }: { readonly onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <ActionRow
      icon="square.and.pencil"
      label={t('personDetail.editContact')}
      onPress={onPress}
      tone="default"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete button — destructive text on destructive@10% fill, 48pt tall
// ─────────────────────────────────────────────────────────────────────────────

function DeleteButton({ onPress }: { readonly onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <ActionRow
      icon="trash"
      label={t('personDetail.deleteContact')}
      onPress={onPress}
      tone="destructive"
    />
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  tone,
}: {
  readonly icon: SFSymbol;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone: 'default' | 'destructive';
}): ReactNode {
  const fg = tone === 'destructive' ? Colors.destructive : Colors.text1;
  const bg =
    tone === 'destructive' ? `${Colors.destructive}1A` : Colors.searchBg;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="rounded-sm2 active:opacity-80"
      style={{
        height: 48,
        backgroundColor: bg,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: 10,
      }}
    >
      <SfIcon name={icon} size={15} color={fg} />
      <Text style={{ color: fg, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
