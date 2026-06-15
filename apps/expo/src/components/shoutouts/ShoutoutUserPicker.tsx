/**
 * ShoutoutUserPicker — port of
 * solidarity/Views/ShoutoutViews/ShoutoutUserPicker.swift.
 *
 * Multi-select recipient picker for composing a new shoutout. Backed by
 * `useContactStore` (the same source the Swift Sakura messaging stack
 * reads). Rows mirror the checkbox/check-circle pattern used in
 * ShareSettingsView and the Sakura UserPickerView:
 *   • Avatar (initials on accentRose ring)
 *   • Name / company / title stack
 *   • Trailing checkbox that toggles inclusion
 *
 * The Swift screen is single-select; the React port exposes multi-select
 * out of the box so callers can decide via `singleSelect`. Single-select
 * mode tapping a row commits immediately; multi-select mode shows a
 * "Confirm (N)" button.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SakuraIcon } from '@/components/brand/SakuraIcon';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useContactListDetail } from '@/contacts/repository';
import { haptic } from '@/feedback/haptics';
import { initials } from '@/shoutouts/ui';
import type { Contact } from '@solidarity/shared';

export interface ShoutoutUserPickerProps {
  readonly visible: boolean;
  readonly initialSelectedIds?: readonly string[];
  readonly singleSelect?: boolean;
  readonly onConfirm: (selected: readonly Contact[]) => void;
  readonly onCancel: () => void;
}

export function ShoutoutUserPicker({
  visible,
  initialSelectedIds,
  singleSelect = false,
  onConfirm,
  onCancel,
}: ShoutoutUserPickerProps): ReactNode {
  const insets = useSafeAreaInsets();
  const contacts = useContactListDetail();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSelectedIds ?? [])
  );

  const filtered = useMemo(() => {
    if (search.length === 0) return contacts;
    const q = search.toLowerCase();
    return contacts.filter((c) => {
      const card = c.businessCard;
      return (
        card.name.toLowerCase().includes(q) ||
        (card.company?.toLowerCase().includes(q) ?? false) ||
        (card.title?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [contacts, search]);

  const toggle = (id: string) => {
    haptic('selection');
    setSelected((prev) => {
      const next = new Set(prev);
      if (singleSelect) {
        next.clear();
        next.add(id);
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commit = (ids: ReadonlySet<string>) => {
    const picks = contacts.filter((c) => ids.has(c.id));
    onConfirm(picks);
  };

  const onRowTap = (contact: Contact) => {
    if (singleSelect) {
      haptic('selection');
      const next = new Set([contact.id]);
      setSelected(next);
      commit(next);
      return;
    }
    toggle(contact.id);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <View
          className="flex-row items-center"
          style={{ paddingHorizontal: 16, paddingVertical: 12 }}
        >
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={{ width: 70 }}
          >
            <Text className="text-primaryBlue" style={{ fontSize: 15 }}>
              Cancel
            </Text>
          </Pressable>
          <Text
            className="text-text1 text-center"
            style={{ flex: 1, fontSize: 17, fontWeight: '600' }}
          >
            Select Recipient
          </Text>
          <View style={{ width: 70 }} />
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View
            className="bg-searchBg flex-row items-center"
            style={{
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: `${Colors.accentRose}4D`,
            }}
          >
            <SfIcon name="magnifyingglass" size={14} color={Colors.accentRose} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search contacts..."
              placeholderTextColor={Colors.text3}
              style={{
                flex: 1,
                marginLeft: 8,
                color: Colors.text1,
                fontSize: 15,
              }}
            />
            {search.length > 0 ? (
              <Pressable
                onPress={() => { setSearch(''); }}
                accessibilityRole="button"
                accessibilityLabel="Clear"
              >
                <Text className="text-text2" style={{ fontSize: 12 }}>
                  Clear
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 32 + insets.bottom,
            gap: 12,
          }}
        >
          {filtered.map((c) => (
            <PickerRow
              key={c.id}
              contact={c}
              checked={selected.has(c.id)}
              onPress={() => { onRowTap(c); }}
            />
          ))}
          {filtered.length === 0 ? (
            <Text
              className="text-text2 text-center"
              style={{ fontSize: 14, marginTop: 24 }}
            >
              No contacts match your search.
            </Text>
          ) : null}
        </ScrollView>

        {!singleSelect ? (
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 16 + insets.bottom,
              borderTopWidth: 0.5,
              borderTopColor: Colors.divider,
              backgroundColor: Colors.pageBg,
            }}
          >
            <ThemedButton
              fullWidth
              label={`Confirm (${String(selected.size)})`}
              disabled={selected.size === 0}
              onPress={() => { commit(selected); }}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function PickerRow({
  contact,
  checked,
  onPress,
}: {
  readonly contact: Contact;
  readonly checked: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const card = contact.businessCard;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`Pick ${card.name}`}
    >
      <View
        className="bg-cardBg flex-row items-center"
        style={{
          borderRadius: 12,
          padding: 16,
          borderWidth: 1,
          borderColor: checked ? Colors.accentRose : Colors.divider,
          gap: 16,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 2,
            borderColor: Colors.accentRose,
            backgroundColor: Colors.primaryMauve,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text className="text-cardBg" style={{ fontSize: 17, fontWeight: '600' }}>
            {initials(card.name)}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text
            className="text-text1"
            numberOfLines={1}
            style={{ fontSize: 16, fontWeight: '600' }}
          >
            {card.name}
          </Text>
          {card.company ? (
            <Text
              className="text-text2"
              numberOfLines={1}
              style={{ fontSize: 13, marginTop: 2 }}
            >
              {card.company}
            </Text>
          ) : null}
          {card.title ? (
            <Text
              className="text-text3"
              numberOfLines={1}
              style={{ fontSize: 12, marginTop: 2 }}
            >
              {card.title}
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'center', gap: 6 }}>
          <SakuraIcon size={20} color={Colors.accentRose} animating={false} />
          <SfIcon
            name={checked ? 'checkmark.circle.fill' : 'circle'}
            size={22}
            color={checked ? Colors.accentRose : Colors.text3}
          />
        </View>
      </View>
    </Pressable>
  );
}
