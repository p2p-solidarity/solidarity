/**
 * ContactPickerView — 1:1 port of Swift ContactPickerView.
 *
 * Bridges the system contact picker on both platforms. iOS uses Apple's
 * `CNContactPickerViewController` via `expo-contacts`'s
 * `presentContactPickerAsync`. Android has no system contact picker
 * surface comparable to iOS, so we render a `Modal` listing all
 * contacts (after a one-time permission request) with single-select
 * tap-to-confirm.
 *
 * Callers pass `visible` + `onPick(contacts)` + `onCancel`. The
 * `contacts` array contains lightly-normalized records (id, name,
 * email, phone) — enough for the import flows that consume this.
 */
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, Text, View } from 'react-native';
import * as Contacts from 'expo-contacts/legacy';

import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';

export interface PickedContact {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
}

interface ContactPickerViewProps {
  readonly visible: boolean;
  readonly onPick: (contacts: readonly PickedContact[]) => void;
  readonly onCancel: () => void;
}

export function ContactPickerView({ visible, onPick, onCancel }: ContactPickerViewProps) {
  if (Platform.OS === 'ios') {
    return <IOSPicker visible={visible} onPick={onPick} onCancel={onCancel} />;
  }
  return <AndroidPicker visible={visible} onPick={onPick} onCancel={onCancel} />;
}

function IOSPicker({ visible, onPick, onCancel }: ContactPickerViewProps) {
  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== Contacts.PermissionStatus.GRANTED) {
        onCancel();
        return;
      }
      const result = await Contacts.presentContactPickerAsync();
      if (!result) {
        onCancel();
        return;
      }
      onPick([toPicked(result)]);
    })();
  }, [visible, onCancel, onPick]);

  return null;
}

function AndroidPicker({ visible, onPick, onCancel }: ContactPickerViewProps) {
  const [items, setItems] = useState<readonly Contacts.ExistingContact[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoaded(false);
    void (async () => {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== Contacts.PermissionStatus.GRANTED) {
        onCancel();
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.Emails,
          Contacts.Fields.PhoneNumbers,
        ],
        sort: Contacts.SortTypes.FirstName,
      });
      setItems(data);
      setLoaded(true);
    })();
  }, [visible, onCancel]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={{ flex: 1, backgroundColor: Colors.pageBg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 0.5,
            borderBottomColor: Colors.divider,
          }}
        >
          <ThemedButton variant="secondary" label="Cancel" onPress={onCancel} />
          <Text style={{ fontWeight: '700', color: Colors.text1, fontSize: 16 }}>
            Select Contact
          </Text>
          <View style={{ width: 72 }} />
        </View>
        {!loaded ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: Colors.text2 }}>Loading contacts…</Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick([toPicked(item)])}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: 0.5,
                  borderBottomColor: Colors.divider,
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 15, color: Colors.text1 }}>
                  {item.name}
                </Text>
                {item.emails && item.emails.length > 0 ? (
                  <Text style={{ marginTop: 2, fontSize: 13, color: Colors.text2 }}>
                    {item.emails[0]?.email ?? ''}
                  </Text>
                ) : null}
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

function toPicked(c: Contacts.ExistingContact): PickedContact {
  const email = c.emails?.[0]?.email;
  const phone = c.phoneNumbers?.[0]?.number;
  return {
    id: c.id,
    name: c.name,
    email: email ?? undefined,
    phone: phone ?? undefined,
  };
}
