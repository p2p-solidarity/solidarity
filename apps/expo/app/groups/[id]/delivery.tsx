/**
 * Group Delivery Settings — 1:1 port of Swift
 * GroupCredentialDeliverySettingsView
 *   (solidarity/Views/IDViews/GroupCredentialDeliverySettingsView.swift).
 *
 * Three sections:
 *   • DEFAULT METHOD — segmented method picker + helper sub-line
 *   • PROXIMITY SETTINGS — Toggle "Require PIN" + optional PIN SecureField
 *   • SAKURA SETTINGS — Toggle "Encrypt Messages"
 *
 * Settings persist to MMKV via deliverySettings.{load,save}. The screen
 * reads on mount and writes on unmount (parity with Swift's
 * `.onAppear` / `.onDisappear` UserDefaults pattern).
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { IDNavBar, IDSectionHeader } from '@/components/id';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  DEFAULT_DELIVERY_SETTINGS,
  DELIVERY_METHODS,
  deliveryMethodLabel,
  loadDeliverySettings,
  saveDeliverySettings,
  type DeliveryMethod,
  type GroupDeliverySettings,
} from '@/groups/deliverySettings';
import { useGroup } from '@/groups/store';
import { Pressable } from 'react-native';

const MONO_FONT = 'Menlo';

export default function GroupDeliverySettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const [settings, setSettings] = useState<GroupDeliverySettings>(
    DEFAULT_DELIVERY_SETTINGS
  );
  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (id) setSettings(loadDeliverySettings(id));
  }, [id]);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    if (id) saveDeliverySettings(id, settings);
  }, [id, settings]);

  const title = group?.name ?? t('groupDelivery.title');

  const onMethodChange = (m: DeliveryMethod): void => {
    setSettings((s) => ({ ...s, defaultDeliveryMethod: m }));
  };

  const onTogglePin = (next: boolean): void => {
    setSettings((s) => ({ ...s, requirePIN: next, pin: next ? s.pin : null }));
  };

  const onPinChange = (text: string): void => {
    setSettings((s) => ({ ...s, pin: text.length === 0 ? null : text }));
  };

  const onToggleEncrypt = (next: boolean): void => {
    setSettings((s) => ({ ...s, encryptMessages: next }));
  };

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar title={t('groupDelivery.title')} leadingLabel={title} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <View className="gap-4">
          <View>
            <View className="pb-2">
              <IDSectionHeader title={t('groupDelivery.defaultMethod')} />
            </View>
            <View
              className="bg-searchBg p-4"
              style={{ borderWidth: 1, borderColor: Colors.divider, gap: 8 }}
            >
              <MethodPicker
                value={settings.defaultDeliveryMethod}
                onChange={onMethodChange}
              />
            </View>
            <Text
              style={{ fontFamily: MONO_FONT }}
              className="text-text3 text-[12px] pt-1.5"
            >
              {t('groupDelivery.defaultMethodHelper')}
            </Text>
          </View>

          <View>
            <View className="pb-2">
              <IDSectionHeader title={t('groupDelivery.proximitySettings')} />
            </View>
            <View
              className="bg-searchBg p-4"
              style={{ borderWidth: 1, borderColor: Colors.divider, gap: 12 }}
            >
              <View className="flex-row items-center">
                <Text className="text-text1 text-[14px] flex-1">
                  {t('groupDelivery.requirePin')}
                </Text>
                <Switch
                  value={settings.requirePIN}
                  onValueChange={onTogglePin}
                  trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
                  thumbColor={Colors.cardBg}
                  ios_backgroundColor={Colors.divider}
                />
              </View>
              {settings.requirePIN ? (
                <TextInput
                  value={settings.pin ?? ''}
                  onChangeText={onPinChange}
                  placeholder={t('groupDelivery.pinPlaceholder')}
                  placeholderTextColor={Colors.text3}
                  secureTextEntry
                  className="text-text1 text-[14px] bg-cardBg px-3 py-2 rounded-md"
                  style={{ borderWidth: 1, borderColor: Colors.divider }}
                />
              ) : null}
            </View>
          </View>

          <View>
            <View className="pb-2">
              <IDSectionHeader title={t('groupDelivery.sakuraSettings')} />
            </View>
            <View
              className="bg-searchBg p-4"
              style={{ borderWidth: 1, borderColor: Colors.divider }}
            >
              <View className="flex-row items-center">
                <Text className="text-text1 text-[14px] flex-1">
                  {t('groupDelivery.encryptMessages')}
                </Text>
                <Switch
                  value={settings.encryptMessages}
                  onValueChange={onToggleEncrypt}
                  trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
                  thumbColor={Colors.cardBg}
                  ios_backgroundColor={Colors.divider}
                />
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function MethodPicker({
  value,
  onChange,
}: {
  readonly value: DeliveryMethod;
  readonly onChange: (m: DeliveryMethod) => void;
}): React.JSX.Element {
  return (
    <View style={{ gap: 4 }}>
      {DELIVERY_METHODS.map((m) => {
        const isActive = m === value;
        return (
          <Pressable
            key={m}
            onPress={() => { onChange(m); }}
            accessibilityRole="button"
            accessibilityLabel={deliveryMethodLabel(m)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 8,
              gap: 10,
            }}
            className="active:opacity-70"
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 2,
                borderColor: isActive ? Colors.primaryBlue : Colors.divider,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isActive ? (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: Colors.primaryBlue,
                  }}
                />
              ) : null}
            </View>
            <Text
              className="text-text1 text-[14px] flex-1"
              style={isActive ? { color: Colors.text1, fontWeight: '600' } : undefined}
            >
              {deliveryMethodLabel(m)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
