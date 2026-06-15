/**
 * GroupVCIssuanceSections — section building blocks for the Group VC
 * Issuance screen. Extracted from `app/groups/[id]/issue-vc.tsx` to keep
 * the screen file under the 500-line cap.
 *
 * Each section mirrors one block from Swift GroupVCIssuanceView
 * (solidarity/Views/IDViews/GroupVCIssuanceView.swift).
 */
import type { ReactNode } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

import { IDSectionHeader } from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type { CardManifestEntry } from '@/cards/cardManifest';
import {
  DELIVERY_METHODS,
  deliveryMethodLabel,
  type DeliveryMethod,
} from '@/groups/deliverySettings';

export interface IssuanceResult {
  readonly memberId: string;
  readonly status: 'success' | 'failure';
  readonly error?: string;
}

/**
 * Toggle palette for the Issue Group VC switches (Figma 763:5102 switch:
 * `on` track #1a1a1a, `off` track #e4e4e4, white thumb). The Solidarity
 * accent is mauve, not iOS blue, so the active state uses the inverted
 * button fill (`invertedButtonBg` ≈ #2F2F30) to read as the same near-black
 * Figma chip — keeping every "on" affordance consistent. Off track uses the
 * divider grey. Shared so all three switches stay identical.
 */
const SWITCH_TRACK_COLOR = {
  false: Colors.divider,
  true: Colors.invertedButtonBg,
} as const;
const SWITCH_THUMB_COLOR = '#FFFFFF';

export function CardSelectSection({
  cards,
  selectedCardId,
  onSelect,
}: {
  readonly cards: readonly CardManifestEntry[];
  readonly selectedCardId: string | null;
  readonly onSelect: (c: CardManifestEntry | null) => void;
}): ReactNode {
  return (
    <View>
      <View className="pb-2">
        <IDSectionHeader title="SELECT BUSINESS CARD" />
      </View>
      <View
        className="bg-searchBg p-4"
        style={{ borderWidth: 1, borderColor: Colors.divider, gap: 4 }}
      >
        <RadioRow
          label="None"
          active={selectedCardId === null}
          onPress={() => { onSelect(null); }}
        />
        {cards.map((c) => (
          <RadioRow
            key={c.id}
            label={c.name}
            active={c.id === selectedCardId}
            onPress={() => { onSelect(c); }}
          />
        ))}
      </View>
    </View>
  );
}

export function DisplaySection({
  hasCard,
  customName,
  onChangeName,
  remember,
  onChangeRemember,
}: {
  readonly hasCard: boolean;
  readonly customName: string;
  readonly onChangeName: (s: string) => void;
  readonly remember: boolean;
  readonly onChangeRemember: (next: boolean) => void;
}): ReactNode {
  return (
    <View>
      <View className="pb-2">
        <IDSectionHeader title="GROUP DISPLAY" />
      </View>
      <View
        style={{ borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden' }}
      >
        {hasCard ? (
          <>
            <TextInput
              value={customName}
              onChangeText={onChangeName}
              placeholder="Name shown in this group"
              placeholderTextColor={Colors.text3}
              autoCapitalize="words"
              autoCorrect={false}
              className="bg-searchBg text-text1 text-[14px] px-4 py-4"
            />
            <View style={{ height: 1, backgroundColor: Colors.divider }} />
            <View
              className="bg-searchBg flex-row items-center"
              style={{ paddingHorizontal: 16, paddingVertical: 14 }}
            >
              <Text className="text-text1 text-[14px] flex-1">
                Remember this card for this group
              </Text>
              <Switch
                value={remember}
                onValueChange={onChangeRemember}
                trackColor={SWITCH_TRACK_COLOR}
                thumbColor={SWITCH_THUMB_COLOR}
                ios_backgroundColor={Colors.divider}
              />
            </View>
          </>
        ) : (
          <View className="bg-searchBg" style={{ padding: 16 }}>
            <Text className="text-text2 text-[14px]">Select a card first</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function RecipientsSection({
  sendToAll,
  onToggleSendAll,
  activeMembers,
  selectedMembers,
  onToggleMember,
}: {
  readonly sendToAll: boolean;
  readonly onToggleSendAll: (next: boolean) => void;
  readonly activeMembers: readonly { readonly userRecordID: string }[];
  readonly selectedMembers: ReadonlySet<string>;
  readonly onToggleMember: (id: string, next: boolean) => void;
}): ReactNode {
  return (
    <View>
      <View className="pb-2">
        <IDSectionHeader title="RECIPIENTS" />
      </View>
      <View
        style={{ borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden' }}
      >
        <View
          className="bg-searchBg flex-row items-center"
          style={{ paddingHorizontal: 16, paddingVertical: 14 }}
        >
          <Text className="text-text1 text-[14px] flex-1">
            Send to All Active Members
          </Text>
          <Switch
            value={sendToAll}
            onValueChange={onToggleSendAll}
            trackColor={SWITCH_TRACK_COLOR}
            thumbColor={SWITCH_THUMB_COLOR}
            ios_backgroundColor={Colors.divider}
          />
        </View>
        {!sendToAll
          ? activeMembers.map((m) => (
              <View key={m.userRecordID}>
                <View style={{ height: 1, backgroundColor: Colors.divider }} />
                <View
                  className="bg-searchBg flex-row items-center"
                  style={{ paddingHorizontal: 16, paddingVertical: 14 }}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    className="text-text1 text-[14px] flex-1"
                  >
                    {m.userRecordID}
                  </Text>
                  <Switch
                    value={selectedMembers.has(m.userRecordID)}
                    onValueChange={(next) => {
                      onToggleMember(m.userRecordID, next);
                    }}
                    trackColor={SWITCH_TRACK_COLOR}
                    thumbColor={SWITCH_THUMB_COLOR}
                    ios_backgroundColor={Colors.divider}
                  />
                </View>
              </View>
            ))
          : null}
      </View>
    </View>
  );
}

export function MethodSection({
  value,
  onChange,
}: {
  readonly value: DeliveryMethod;
  readonly onChange: (m: DeliveryMethod) => void;
}): ReactNode {
  return (
    <View>
      <View className="pb-2">
        <IDSectionHeader title="DELIVERY METHOD" />
      </View>
      <View
        className="bg-searchBg p-4"
        style={{ borderWidth: 1, borderColor: Colors.divider, gap: 4 }}
      >
        {DELIVERY_METHODS.map((m) => (
          <RadioRow
            key={m}
            label={deliveryMethodLabel(m)}
            active={m === value}
            onPress={() => { onChange(m); }}
          />
        ))}
      </View>
    </View>
  );
}

export function ExpirationSection({
  enabled,
  onToggle,
  expirationDate,
}: {
  readonly enabled: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly expirationDate: Date | null;
}): ReactNode {
  return (
    <View>
      <View className="pb-2">
        <IDSectionHeader title="EXPIRATION (OPTIONAL)" />
      </View>
      <View
        style={{ borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden' }}
      >
        <View
          className="bg-searchBg flex-row items-center"
          style={{ paddingHorizontal: 16, paddingVertical: 14 }}
        >
          <Text className="text-text1 text-[14px] flex-1">Set Expiration</Text>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={SWITCH_TRACK_COLOR}
            thumbColor={SWITCH_THUMB_COLOR}
            ios_backgroundColor={Colors.divider}
          />
        </View>
        {enabled && expirationDate ? (
          <>
            <View style={{ height: 1, backgroundColor: Colors.divider }} />
            <View
              className="bg-searchBg flex-row items-center"
              style={{ paddingHorizontal: 16, paddingVertical: 14 }}
            >
              <Text className="text-text1 text-[14px] flex-1">Expires</Text>
              <Text className="text-text2 text-[13px]">
                {expirationDate.toLocaleDateString()}
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

export function ResultsSection({
  results,
}: {
  readonly results: readonly IssuanceResult[];
}): ReactNode {
  return (
    <View>
      <View className="pb-2">
        <IDSectionHeader title="RESULTS" />
      </View>
      <View
        style={{ borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden' }}
      >
        {results.map((r, idx) => (
          <View key={`${r.memberId}-${String(idx)}`}>
            <View
              className="bg-searchBg flex-row items-center"
              style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 8 }}
            >
              <SfIcon
                name={
                  r.status === 'success'
                    ? 'checkmark.circle.fill'
                    : 'xmark.circle.fill'
                }
                size={16}
                color={
                  r.status === 'success'
                    ? Colors.terminalGreen
                    : Colors.destructive
                }
              />
              <Text
                numberOfLines={2}
                style={{
                  color:
                    r.status === 'success'
                      ? Colors.terminalGreen
                      : Colors.destructive,
                  fontSize: 14,
                  flex: 1,
                }}
              >
                {r.status === 'success'
                  ? `Sent to ${r.memberId}`
                  : `Failed: ${r.memberId}${r.error ? ` — ${r.error}` : ''}`}
              </Text>
            </View>
            {idx < results.length - 1 ? (
              <View style={{ height: 1, backgroundColor: Colors.divider }} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function RadioRow({
  label,
  active,
  onPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
      }}
      className="active:opacity-70"
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: active ? Colors.primaryBlue : Colors.divider,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {active ? (
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
        numberOfLines={1}
        className="text-text1 text-[14px] flex-1"
        style={active ? { color: Colors.text1, fontWeight: '600' } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}
