/**
 * EditContactSheet — full editor for an existing Contact's business-card
 * fields.
 *
 * Previously the person-detail screen only exposed a note field via
 * `PersonDetailMoreSheet`. Anything else — typo in a name, a missing email,
 * an updated job title — required deleting the row and re-importing. This
 * sheet lets users edit the same fields they enter when adding a contact
 * manually (`ManualContactEntrySheet`) so corrections work in-place.
 *
 * Visual contract matches `ManualContactEntrySheet` so the two flows look
 * unified. Saving preserves the original `id`, `receivedAt`, `source`,
 * `verificationStatus`, sealed-route keys, and signatures — we only mutate
 * the user-editable subset.
 */
import { useState, type ReactNode } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModalSheet } from '@/components/common/ModalSheet';
import { Colors } from '@/constants/Colors';
import { useContactStore } from '@/contacts/repository';
import { showError } from '@/feedback/appAlert';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import type { Contact } from '@solidarity/shared';

export interface EditContactSheetProps {
  readonly visible: boolean;
  readonly contact: Contact;
  readonly onClose: () => void;
  readonly onSaved?: (next: Contact) => void;
}

export function EditContactSheet({
  visible,
  contact,
  onClose,
  onSaved,
}: EditContactSheetProps): ReactNode {
  return (
    <ModalSheet visible={visible} presentationStyle="formSheet" onRequestClose={onClose}>
      {/* Re-mount the inner content per-contact so the form draft tracks
          whichever contact is being edited. */}
      <EditContactSheetContent
        key={contact.id}
        contact={contact}
        onClose={onClose}
        onSaved={onSaved}
      />
    </ModalSheet>
  );
}

function EditContactSheetContent({
  contact,
  onClose,
  onSaved,
}: {
  readonly contact: Contact;
  readonly onClose: () => void;
  readonly onSaved?: (next: Contact) => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const upsert = useContactStore((s) => s.upsert);

  const card = contact.businessCard;
  const [name, setName] = useState(card.name);
  const [title, setTitle] = useState(card.title ?? '');
  const [company, setCompany] = useState(card.company ?? '');
  const [email, setEmail] = useState(card.email ?? '');
  const [phone, setPhone] = useState(card.phone ?? '');
  const [tags, setTags] = useState(contact.tags.join(', '));
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [validationMessage, setValidationMessage] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  const onSave = (): void => {
    if (saving) return;
    if (trimmedName.length === 0) {
      setValidationMessage(t('personDetail.nameRequired'));
      return;
    }
    const next: Contact = {
      ...contact,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      notes: notes.trim().length > 0 ? notes.trim() : undefined,
      businessCard: {
        ...card,
        name: trimmedName,
        title: title.trim().length > 0 ? title.trim() : undefined,
        company: company.trim().length > 0 ? company.trim() : undefined,
        email: email.trim().length > 0 ? email.trim() : undefined,
        phone: phone.trim().length > 0 ? phone.trim() : undefined,
        updatedAt: new Date(),
      },
    };

    void (async () => {
      setSaving(true);
      try {
        await upsert(next);
        pushToast(t('personDetail.contactUpdated'), 'success', 2000);
        onSaved?.(next);
        onClose();
      } catch (error) {
        showError({
          context: 'People › Edit Contact',
          summary: t('personDetail.updateFailed'),
          error,
        });
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.pageBg }}>
      <View style={{ paddingTop: insets.top }}>
        <Toolbar
          onCancel={onClose}
          onSave={onSave}
          canSave={canSave && !saving}
          saving={saving}
        />
      </View>

      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 32 }}
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
            label="Tags"
            placeholder="Comma separated"
            value={tags}
            onChange={setTags}
            autoCapitalize="none"
          />
          <FieldRow
            label="Note"
            placeholder="Optional"
            value={notes}
            onChange={setNotes}
            autoCapitalize="sentences"
            multiline
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
      </KeyboardAwareScrollView>
    </View>
  );
}

function Toolbar({
  onCancel,
  onSave,
  canSave,
  saving,
}: {
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly canSave: boolean;
  readonly saving: boolean;
}): ReactNode {
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, height: 44 }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        disabled={saving}
        hitSlop={8}
      >
        <Text className="text-text1" style={{ fontSize: 16 }}>
          Cancel
        </Text>
      </Pressable>

      <Text className="text-text1" style={{ fontSize: 17, fontWeight: '600' }}>
        Edit Contact
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
          {saving ? 'Saving…' : 'Save'}
        </Text>
      </Pressable>
    </View>
  );
}

interface FieldRowProps {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly multiline?: boolean;
}

function FieldRow({
  label,
  placeholder,
  value,
  onChange,
  keyboardType,
  autoCapitalize = 'words',
  multiline = false,
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
          minHeight: multiline ? 88 : 44,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 0,
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
          multiline={multiline}
          className="text-text1"
          style={{
            fontSize: 15,
            padding: 0,
            ...(multiline ? { textAlignVertical: 'top' as const, minHeight: 68 } : null),
          }}
        />
      </View>
    </View>
  );
}
