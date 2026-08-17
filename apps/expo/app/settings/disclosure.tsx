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
import { safeBack } from '@/navigation/safeBack';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';
import type { BusinessCardField, SharingLevel } from '@solidarity/shared';
import type { SFSymbol } from 'expo-symbols';

const LEVELS: readonly SharingLevel[] = ['public', 'professional', 'personal'];

const LEVEL_DISPLAY_KEY: Readonly<Record<SharingLevel, string>> = {
  public: 'disclosure.level.public',
  professional: 'disclosure.level.professional',
  personal: 'disclosure.level.personal',
};

const LEVEL_ICON: Readonly<Record<SharingLevel, SFSymbol>> = {
  public: 'globe',
  professional: 'briefcase',
  personal: 'person.2',
};

const LEVEL_DESCRIPTION_KEY: Readonly<Record<SharingLevel, string>> = {
  public: 'disclosure.levelDescription.public',
  professional: 'disclosure.levelDescription.professional',
  personal: 'disclosure.levelDescription.personal',
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

const FIELD_DISPLAY_KEY: Readonly<Record<BusinessCardField, string>> = {
  name: 'disclosure.field.name',
  title: 'disclosure.field.title',
  company: 'disclosure.field.company',
  email: 'disclosure.field.email',
  phone: 'disclosure.field.phone',
  profileImage: 'disclosure.field.profileImage',
  socialNetworks: 'disclosure.field.socialNetworks',
  skills: 'disclosure.field.skills',
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

const EXPIRATION_OPTIONS: readonly { labelKey: string; days: number }[] = [
  { labelKey: 'disclosure.expiration.7days', days: 7 },
  { labelKey: 'disclosure.expiration.30days', days: 30 },
  { labelKey: 'disclosure.expiration.90days', days: 90 },
  { labelKey: 'disclosure.expiration.never', days: 36500 },
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
  const { t } = useTranslation();
  const developerMode = usePreferences((state) => state.developerMode);

  // Local UI state mirrors Swift @State (these are not yet persisted —
  // Swift wires them to a @Binding<SharingPreferences>; that store binding
  // ships in the next PR. UI parity is preserved.)
  const [useZK, setUseZK] = useState(true);
  const [allowForwarding, setAllowForwarding] = useState(true);
  const [expirationDays, setExpirationDays] = useState(30);
  const [selectedLevel, setSelectedLevel] = useState<SharingLevel>('public');
  const [expirationOpen, setExpirationOpen] = useState(false);

  const [matrix, setMatrix] = useState<Record<SharingLevel, Set<BusinessCardField>>>({
    public: new Set(DEFAULT_FIELDS.public),
    professional: new Set(DEFAULT_FIELDS.professional),
    personal: new Set(DEFAULT_FIELDS.personal),
  });

  const toggleField = (level: SharingLevel, field: BusinessCardField) => {
    setMatrix((prev) => {
      const next = new Set(prev[level]);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return { ...prev, [level]: next };
    });
  };

  const currentExpirationLabel = t(
    EXPIRATION_OPTIONS.find((o) => o.days === expirationDays)?.labelKey ??
      'disclosure.expiration.30days'
  );

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: headerless ? 0 : insets.top }}>
      {!headerless ? (
        <>
          <SettingsBackToolbar
            onPress={() => {
              safeBack('/settings');
            }}
          />
          <SettingsScreenTitle title={t('disclosure.title')} />
        </>
      ) : null}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingVertical: 16, paddingBottom: 24 + insets.bottom }}>
        {/* Overall section — one rounded card containing 3 rows */}
        <View
          className="mx-4 overflow-hidden rounded-xl bg-cardBg"
          style={{ borderWidth: 1, borderColor: Colors.divider }}>
          {developerMode ? (
            <>
              {/* The low-level privacy switch is diagnostic-only and follows the
                  app-wide five-tap Developer Mode gate. */}
              <View className="flex-row items-center" style={{ padding: 16 }}>
                <View
                  className="items-center justify-center rounded-lg"
                  style={{
                    width: 30,
                    height: 30,
                    marginRight: 12,
                    backgroundColor: useZK ? 'rgba(128,0,255,0.1)' : 'rgba(255,0,0,0.1)',
                  }}>
                  <SfIcon
                    name={useZK ? 'eye.slash.fill' : 'exclamationmark.triangle.fill'}
                    size={20}
                    color={useZK ? Colors.primaryMauve : Colors.destructive}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[17px] text-text1">{t('disclosure.zkPrivacy')}</Text>
                  <Text
                    className="text-[12px]"
                    style={{
                      marginTop: 2,
                      color: useZK ? Colors.text2 : Colors.destructive,
                    }}>
                    {useZK ? t('disclosure.active') : t('disclosure.disabledUnsafe')}
                  </Text>
                </View>
                <Switch
                  value={useZK}
                  onValueChange={setUseZK}
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
            </>
          ) : null}

          {/* Allow Forwarding row */}
          <View className="flex-row items-center" style={{ padding: 16 }}>
            <View
              className="items-center justify-center rounded-lg"
              style={{
                width: 30,
                height: 30,
                marginRight: 12,
                backgroundColor: 'rgba(0,122,255,0.1)',
              }}>
              <SfIcon name="arrowshape.turn.up.right.fill" size={20} color={Colors.primaryBlue} />
            </View>
            <View className="flex-1">
              <Text className="text-[17px] text-text1">{t('disclosure.allowForwarding')}</Text>
              <Text className="text-[12px] text-text2" style={{ marginTop: 2 }}>
                {t('disclosure.allowForwardingSubtitle')}
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
            onPress={() => {
              setExpirationOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('disclosure.expiration')}
            className="flex-row items-center active:opacity-80"
            style={{ padding: 16 }}>
            <View
              className="items-center justify-center rounded-lg"
              style={{
                width: 30,
                height: 30,
                marginRight: 12,
                backgroundColor: 'rgba(255,149,0,0.1)',
              }}>
              <SfIcon name="clock.fill" size={20} color="#FF9500" />
            </View>
            <View className="flex-1">
              <Text className="text-[17px] text-text1">{t('disclosure.expiration')}</Text>
            </View>
            <Text className="text-[15px] text-text2" style={{ marginRight: 6 }}>
              {currentExpirationLabel}
            </Text>
            <SfIcon name="chevron.up.chevron.down" size={11} color={Colors.text3} />
          </Pressable>
        </View>

        {/* Level picker — 3 segmented icon-buttons */}
        <View
          className="mx-4 mt-4 flex-row rounded-xl bg-cardBg"
          style={{ padding: 4, borderWidth: 1, borderColor: Colors.divider }}>
          {LEVELS.map((level) => {
            const active = selectedLevel === level;
            return (
              <Pressable
                key={level}
                onPress={() => {
                  setSelectedLevel(level);
                }}
                accessibilityRole="button"
                accessibilityLabel={t(LEVEL_DISPLAY_KEY[level])}
                className="flex-1 items-center rounded-lg active:opacity-80"
                style={{
                  paddingVertical: 8,
                  backgroundColor: active ? 'rgba(191,128,167,0.1)' : 'transparent',
                }}>
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
                  style={{ color: active ? Colors.accentRose : Colors.text2 }}>
                  {t(LEVEL_DISPLAY_KEY[level])}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Privacy level fields */}
        <View className="mt-4">
          <Text
            className="text-center text-[13px] text-text2"
            style={{ paddingHorizontal: 16, marginBottom: 16 }}>
            {t(LEVEL_DESCRIPTION_KEY[selectedLevel])}
          </Text>

          <View
            className="mx-4 overflow-hidden rounded-xl bg-cardBg"
            style={{ borderWidth: 1, borderColor: Colors.divider }}>
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
                      }}>
                      <SfIcon name={FIELD_ICON[field]} size={16} color={Colors.text2} />
                    </View>
                    <Text className="flex-1 text-[17px] text-text1">
                      {t(FIELD_DISPLAY_KEY[field])}
                    </Text>
                    {isName ? (
                      <SfIcon name="checkmark.circle.fill" size={20} color={Colors.text2} />
                    ) : (
                      <Switch
                        value={isOn}
                        onValueChange={() => {
                          toggleField(selectedLevel, field);
                        }}
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
        onRequestClose={() => {
          setExpirationOpen(false);
        }}>
        <Pressable
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => {
            setExpirationOpen(false);
          }}>
          <View className="rounded-2xl bg-cardBg" style={{ width: 280, paddingVertical: 8 }}>
            <Text
              className="text-[13px] text-text2"
              style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              {t('disclosure.expiration')}
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
                  style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text
                    className="flex-1 text-[15px] text-text1"
                    style={{ fontWeight: active ? '600' : '400' }}>
                    {t(opt.labelKey)}
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
