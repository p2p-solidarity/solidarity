/**
 * ManualContactEntrySheet — 1:1 port of
 * solidarity/Views/PeopleViews/ManualContactEntrySheet.swift.
 *
 * Lightweight form for typing a contact directly into the People list
 * without bouncing through the system Contacts picker. Saved contacts are
 * marked source = 'Manual' and remain Unverified — they don't carry a
 * cryptographic signature, just user-entered fields.
 *
 * Wrapped in a slide-in RN `Modal` so it can be presented from the People
 * tab "Add Manually" menu without a router push. Mirror the Swift sheet
 * layout: 12pt mono-bold uppercase label + 44pt searchBg field, 16pt
 * horiz padding, "Cancel" / "Save" inline toolbar.
 */
import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/Colors';
import { useContactStore } from '@/contacts/repository';
import { pushToast } from '@/feedback/toast';
import { uuid } from '@solidarity/shared';
import type { Contact } from '@solidarity/shared';

export interface ManualContactEntrySheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Fires after the contact is persisted (so callers can refresh / nav). */
  readonly onSaved?: (contact: Contact) => void;
}

export function ManualContactEntrySheet({
  visible,
  onClose,
  onSaved,
}: ManualContactEntrySheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <ManualContactEntryContent onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner content — split so the modal frame doesn't re-mount on close (avoids
// blowing away the draft when the user dismisses and reopens).
// ─────────────────────────────────────────────────────────────────────────────

function ManualContactEntryContent({
  onClose,
  onSaved,
}: {
  readonly onClose: () => void;
  readonly onSaved?: (contact: Contact) => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const upsert = useContactStore((s) => s.upsert);

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | undefined>();

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  const onSave = (): void => {
    if (trimmedName.length === 0) {
      setValidationMessage('Name is required.');
      return;
    }
    const now = new Date();
    const contact: Contact = {
      id: uuid(),
      receivedAt: now,
      source: 'Manual',
      tags: [],
      verificationStatus: 'Unverified',
      notes: notes.trim().length > 0 ? notes.trim() : undefined,
      businessCard: {
        id: uuid(),
        name: trimmedName,
        title: title.trim().length > 0 ? title.trim() : undefined,
        company: company.trim().length > 0 ? company.trim() : undefined,
        email: email.trim().length > 0 ? email.trim() : undefined,
        phone: phone.trim().length > 0 ? phone.trim() : undefined,
        socialNetworks: [],
        skills: [],
        categories: [],
        sharingPreferences: {
          publicFields: new Set(['name']),
          professionalFields: new Set(['name', 'title', 'company', 'email']),
          personalFields: new Set(['name', 'email', 'phone']),
          allowForwarding: true,
          useZK: false,
          sharingFormat: 'didSigned',
        },
        verifiedFields: undefined,
        nameType: 'display_name',
        createdAt: now,
        updatedAt: now,
      },
    };

    void (async () => {
      await upsert(contact);
      pushToast(`Saved ${trimmedName}`, 'success');
      onSaved?.(contact);
      onClose();
    })();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: Colors.pageBg }}
    >
      <View style={{ paddingTop: insets.top }}>
        <Toolbar onCancel={onClose} onSave={onSave} canSave={canSave} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }}
      >
        <View style={{ rowGap: 20 }}>
          <FieldRow
            label="Name"
            placeholder="Required"
            value={name}
            onChange={setName}
            autoCapitalize="words"
          />
          <FieldRow
            label="Title"
            placeholder="Optional"
            value={title}
            onChange={setTitle}
            autoCapitalize="words"
          />
          <FieldRow
            label="Company"
            placeholder="Optional"
            value={company}
            onChange={setCompany}
            autoCapitalize="words"
          />
          <FieldRow
            label="Email"
            placeholder="Optional"
            value={email}
            onChange={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <FieldRow
            label="Phone"
            placeholder="Optional"
            value={phone}
            onChange={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
          />
          <FieldRow
            label="Note"
            placeholder="Optional"
            value={notes}
            onChange={setNotes}
            autoCapitalize="sentences"
          />

          {validationMessage ? (
            <Text
              style={{
                fontSize: 12,
                fontFamily: 'Menlo',
                color: Colors.destructive,
                paddingTop: 4,
              }}
            >
              {validationMessage}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar — "Cancel" leading + centred "Add Contact" title + "Save" trailing.
// Matches Swift's NavigationStack inline toolbar styling.
// ─────────────────────────────────────────────────────────────────────────────

function Toolbar({
  onCancel,
  onSave,
  canSave,
}: {
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly canSave: boolean;
}): ReactNode {
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, height: 44 }}
    >
      <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
        <Text className="text-text1" style={{ fontSize: 16 }}>
          Cancel
        </Text>
      </Pressable>

      <Text className="text-text1" style={{ fontSize: 17, fontWeight: '600' }}>
        Add Contact
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={onSave}
        disabled={!canSave}
        hitSlop={8}
      >
        <Text
          style={{
            fontSize: 16,
            color: canSave ? Colors.text1 : Colors.text3,
            fontWeight: '600',
          }}
        >
          Save
        </Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field row — 12pt mono-bold uppercase label + 44pt searchBg field
// ─────────────────────────────────────────────────────────────────────────────

interface FieldRowProps {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
}

function FieldRow({
  label,
  placeholder,
  value,
  onChange,
  keyboardType,
  autoCapitalize = 'words',
}: FieldRowProps): ReactNode {
  return (
    <View style={{ rowGap: 6 }}>
      <Text
        className="text-text3"
        style={{ fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' }}
      >
        {label}
      </Text>
      <View
        className="bg-searchBg rounded-sm2"
        style={{
          height: 44,
          paddingHorizontal: 12,
          borderWidth: 0.5,
          borderColor: Colors.divider,
          justifyContent: 'center',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.text3}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          className="text-text1"
          style={{ fontSize: 15, padding: 0 }}
        />
      </View>
    </View>
  );
}
