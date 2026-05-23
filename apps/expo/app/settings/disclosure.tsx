/**
 * Selective Disclosure — 1:1 port of
 * solidarity/Views/SettingsViews/SelectiveDisclosureSettingsView.swift.
 *
 * Three regions inside a systemGroupedBackground:
 *   1. overallSection (one card with three rows):
 *      - Zero-Knowledge Privacy row (20pt icon in tinted square,
 *        title + status, ON/OFF text by default; tripple-tap reveals Toggle)
 *      - Allow Forwarding ToggleRow (arrowshape.turn.up.right.fill, blue)
 *      - Expiration row (clock.fill, orange; Picker: 7/30/90/Never)
 *   2. levelPicker — 3 segmented buttons with icon+label (public/pro/personal).
 *   3. PrivacyLevelView — description footnote + per-field rows for the
 *      selected level (each field a row in a 12pt rounded card; "Name" is
 *      locked with a check icon, all other fields toggle).
 *
 * For the Settings stack we render the same component but allow the parent
 * (privacy.tsx) to skip the title via `headerless`.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import type { BusinessCardField, SharingLevel } from '@solidarity/shared';
import type { SFSymbol } from 'expo-symbols';

const LEVELS: readonly SharingLevel[] = ['public', 'professional', 'personal'];

const LEVEL_DISPLAY: Readonly<Record<SharingLevel, string>> = {
  public: 'Public',
  professional: 'Professional',
  personal: 'Personal',
};

const LEVEL_ICON: Readonly<Record<SharingLevel, SFSymbol>> = {
  public: 'globe',
  professional: 'briefcase',
  personal: 'person.2',
};

const LEVEL_DESCRIPTION: Readonly<Record<SharingLevel, string>> = {
  public:
    'Fields visible when you share your public card (e.g. QR in slides or website).',
  professional:
    'For work contacts and events. Usually includes email and skills.',
  personal: 'For close contacts. Typically includes all fields.',
};

const FIELDS: readonly BusinessCardField[] = [
  'name',
  'title',
  'company',
  'email',
  'phone',
  'profileImage',
  'socialNetworks',
  'skills',
];

const FIELD_DISPLAY: Readonly<Record<BusinessCardField, string>> = {
  name: 'Name',
  title: 'Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  profileImage: 'Profile Image',
  socialNetworks: 'Social Networks',
  skills: 'Skills',
};

const FIELD_ICON: Readonly<Record<BusinessCardField, SFSymbol>> = {
  name: 'person.text.rectangle',
  title: 'briefcase',
  company: 'building.2',
  email: 'envelope',
  phone: 'phone',
  profileImage: 'person.crop.circle',
  socialNetworks: 'link',
  skills: 'star',
};

const EXPIRATION_OPTIONS: readonly { label: string; days: number }[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'Never', days: 36500 },
];

const DEFAULT_FIELDS: Readonly<Record<SharingLevel, readonly BusinessCardField[]>> = {
  public: ['name'],
  professional: ['name', 'title', 'company', 'email'],
  personal: ['name', 'email', 'phone'],
};

interface DisclosureBodyProps {
  /** When true, skip the back toolbar + screen title (used by privacy.tsx). */
  headerless?: boolean;
}

export default function SelectiveDisclosureBody({ headerless = false }: DisclosureBodyProps) {
  const insets = useSafeAreaInsets();

  // Local UI state mirrors Swift @State (these are not yet persisted —
  // Swift wires them to a @Binding<SharingPreferences>; that store binding
  // ships in the next PR. UI parity is preserved.)
  const [useZK, setUseZK] = useState(true);
  const [allowForwarding, setAllowForwarding] = useState(true);
  const [expirationDays, setExpirationDays] = useState(30);
  const [showDevToggle, setShowDevToggle] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<SharingLevel>('public');
  const [tapCount, setTapCount] = useState(0);
  const [expirationOpen, setExpirationOpen] = useState(false);

  const [matrix, setMatrix] = useState<Record<SharingLevel, Set<BusinessCardField>>>({
    public: new Set(DEFAULT_FIELDS.public),
    professional: new Set(DEFAULT_FIELDS.professional),
    personal: new Set(DEFAULT_FIELDS.personal),
  });

  const onZkTap = () => {
    const next = tapCount + 1;
    if (next >= 3) {
      setShowDevToggle((v) => !v);
      setTapCount(0);
      haptic('warning');
    } else {
      setTapCount(next);
      setTimeout(() => { setTapCount(0); }, 500);
    }
  };

  const toggleField = (level: SharingLevel, field: BusinessCardField) => {
    setMatrix((prev) => {
      const next = new Set(prev[level]);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return { ...prev, [level]: next };
    });
  };

  const currentExpirationLabel =
    EXPIRATION_OPTIONS.find((o) => o.days === expirationDays)?.label ?? '30 days';

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: headerless ? 0 : insets.top }}>
      {!headerless ? (
        <>
          <SettingsBackToolbar onPress={() => { router.back(); }} />
          <SettingsScreenTitle title="Selective Disclosure" />
        </>
      ) : null}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingVertical: 16, paddingBottom: 24 + insets.bottom }}
      >
        {/* Overall section — one rounded card containing 3 rows */}
        <View
          className="mx-4 bg-cardBg rounded-xl overflow-hidden"
          style={{ borderWidth: 1, borderColor: Colors.divider }}
        >
          {/* Zero-Knowledge Privacy row */}
          <Pressable
            onPress={onZkTap}
            accessibilityRole="button"
            accessibilityLabel="Zero-Knowledge Privacy"
            className="flex-row items-center active:opacity-90"
            style={{ padding: 16, opacity: useZK ? 1 : showDevToggle ? 1 : 0.8 }}
          >
            <View
              className="items-center justify-center rounded-lg"
              style={{
                width: 30,
                height: 30,
                marginRight: 12,
                backgroundColor: useZK ? 'rgba(128,0,255,0.1)' : 'rgba(255,0,0,0.1)',
              }}
            >
              <SfIcon
                name={useZK ? 'eye.slash.fill' : 'exclamationmark.triangle.fill'}
                size={20}
                color={useZK ? Colors.primaryMauve : Colors.destructive}
              />
            </View>
            <View className="flex-1">
              <Text className="text-text1 text-[17px]">Zero-Knowledge Privacy</Text>
              <Text
                className="text-[12px]"
                style={{
                  marginTop: 2,
                  color: useZK ? Colors.text2 : Colors.destructive,
                }}
              >
                {useZK ? 'Active' : 'Disabled (Unsafe)'}
              </Text>
            </View>
            {showDevToggle ? (
              <Switch
                value={useZK}
                onValueChange={setUseZK}
                trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
                thumbColor={Colors.cardBg}
                ios_backgroundColor={Colors.divider}
              />
            ) : (
              <Text className="text-text2 text-[15px] font-semibold">
                {useZK ? 'ON' : 'OFF'}
              </Text>
            )}
          </Pressable>

          <View
            style={{
              height: 1,
              marginLeft: 50,
              backgroundColor: Colors.divider,
            }}
          />

          {/* Allow Forwarding row */}
          <View className="flex-row items-center" style={{ padding: 16 }}>
            <View
              className="items-center justify-center rounded-lg"
              style={{
                width: 30,
                height: 30,
                marginRight: 12,
                backgroundColor: 'rgba(0,122,255,0.1)',
              }}
            >
              <SfIcon
                name="arrowshape.turn.up.right.fill"
                size={20}
                color={Colors.primaryBlue}
              />
            </View>
            <View className="flex-1">
              <Text className="text-text1 text-[17px]">Allow Forwarding</Text>
              <Text className="text-text2 text-[12px]" style={{ marginTop: 2 }}>
                Allow recipients to re-share your card.
              </Text>
            </View>
            <Switch
              value={allowForwarding}
              onValueChange={setAllowForwarding}
              trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
              thumbColor={Colors.cardBg}
              ios_backgroundColor={Colors.divider}
            />
          </View>

          <View
            style={{
              height: 1,
              marginLeft: 50,
              backgroundColor: Colors.divider,
            }}
          />

          {/* Expiration row */}
          <Pressable
            onPress={() => { setExpirationOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel="Expiration"
            className="flex-row items-center active:opacity-80"
            style={{ padding: 16 }}
          >
            <View
              className="items-center justify-center rounded-lg"
              style={{
                width: 30,
                height: 30,
                marginRight: 12,
                backgroundColor: 'rgba(255,149,0,0.1)',
              }}
            >
              <SfIcon name="clock.fill" size={20} color="#FF9500" />
            </View>
            <View className="flex-1">
              <Text className="text-text1 text-[17px]">Expiration</Text>
            </View>
            <Text className="text-text2 text-[15px]" style={{ marginRight: 6 }}>
              {currentExpirationLabel}
            </Text>
            <SfIcon name="chevron.up.chevron.down" size={11} color={Colors.text3} />
          </Pressable>
        </View>

        {/* Level picker — 3 segmented icon-buttons */}
        <View
          className="mx-4 mt-4 bg-cardBg rounded-xl flex-row"
          style={{ padding: 4, borderWidth: 1, borderColor: Colors.divider }}
        >
          {LEVELS.map((level) => {
            const active = selectedLevel === level;
            return (
              <Pressable
                key={level}
                onPress={() => { setSelectedLevel(level); }}
                accessibilityRole="button"
                accessibilityLabel={LEVEL_DISPLAY[level]}
                className="flex-1 items-center rounded-lg active:opacity-80"
                style={{
                  paddingVertical: 8,
                  backgroundColor: active ? 'rgba(191,128,167,0.1)' : 'transparent',
                }}
              >
                <View style={{ marginBottom: 6 }}>
                  <SfIcon
                    name={LEVEL_ICON[level]}
                    size={18}
                    weight="medium"
                    color={active ? Colors.accentRose : Colors.text2}
                  />
                </View>
                <Text
                  className="text-[12px] font-medium"
                  style={{ color: active ? Colors.accentRose : Colors.text2 }}
                >
                  {LEVEL_DISPLAY[level]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Privacy level fields */}
        <View className="mt-4">
          <Text
            className="text-text2 text-[13px] text-center"
            style={{ paddingHorizontal: 16, marginBottom: 16 }}
          >
            {LEVEL_DESCRIPTION[selectedLevel]}
          </Text>

          <View
            className="mx-4 bg-cardBg rounded-xl overflow-hidden"
            style={{ borderWidth: 1, borderColor: Colors.divider }}
          >
            {FIELDS.map((field, idx) => {
              const isName = field === 'name';
              const isOn = matrix[selectedLevel].has(field);
              const showDivider = idx !== FIELDS.length - 1;
              return (
                <View key={field}>
                  <View className="flex-row items-center" style={{ padding: 16 }}>
                    <View
                      style={{
                        width: 24,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 12,
                      }}
                    >
                      <SfIcon name={FIELD_ICON[field]} size={16} color={Colors.text2} />
                    </View>
                    <Text className="text-text1 text-[17px] flex-1">
                      {FIELD_DISPLAY[field]}
                    </Text>
                    {isName ? (
                      <SfIcon
                        name="checkmark.circle.fill"
                        size={20}
                        color={Colors.text2}
                      />
                    ) : (
                      <Switch
                        value={isOn}
                        onValueChange={() => { toggleField(selectedLevel, field); }}
                        trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
                        thumbColor={Colors.cardBg}
                        ios_backgroundColor={Colors.divider}
                      />
                    )}
                  </View>
                  {showDivider ? (
                    <View
                      style={{
                        height: 1,
                        marginLeft: 52,
                        backgroundColor: Colors.divider,
                      }}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Expiration picker modal */}
      <Modal
        visible={expirationOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setExpirationOpen(false); }}
      >
        <Pressable
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => { setExpirationOpen(false); }}
        >
          <View
            className="bg-cardBg rounded-2xl"
            style={{ width: 280, paddingVertical: 8 }}
          >
            <Text
              className="text-text2 text-[13px]"
              style={{ paddingHorizontal: 16, paddingVertical: 8 }}
            >
              Expiration
            </Text>
            {EXPIRATION_OPTIONS.map((opt) => {
              const active = opt.days === expirationDays;
              return (
                <Pressable
                  key={opt.days}
                  onPress={() => {
                    setExpirationDays(opt.days);
                    setExpirationOpen(false);
                  }}
                  accessibilityRole="button"
                  className="flex-row items-center active:opacity-80"
                  style={{ paddingHorizontal: 16, paddingVertical: 12 }}
                >
                  <Text
                    className="text-text1 text-[15px] flex-1"
                    style={{ fontWeight: active ? '600' : '400' }}
                  >
                    {opt.label}
                  </Text>
                  {active ? (
                    <SfIcon
                      name="checkmark"
                      size={14}
                      weight="semibold"
                      color={Colors.primaryBlue}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
