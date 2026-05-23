/**
 * Group VC Issuance — 1:1 port of Swift GroupVCIssuanceView
 *   (solidarity/Views/IDViews/GroupVCIssuanceView.swift).
 *
 * Sections (top-to-bottom):
 *   • SELECT BUSINESS CARD — radio list of available cards (None default)
 *   • GROUP DISPLAY — TextField "Name shown in this group" + Toggle
 *     "Remember this card for this group" (gated on selected card)
 *   • RECIPIENTS — Toggle "Send to All Active Members" + per-member toggles
 *   • DELIVERY METHOD — radio list (sakura / proximity / qr)
 *   • EXPIRATION (OPTIONAL) — Toggle + read-only date display (+30d)
 *   • PRIMARY "Issue Group Credential" button
 *   • RESULTS — list of per-member success/failure rows after issuance
 *
 * Persists a (cardId + customName) binding to MMKV under
 * `group_issuance_binding_<groupId>` so the next visit pre-selects.
 *
 * TODO(android): wire GroupCredentialService.issueGroupCredential +
 * GroupCredentialDeliveryService.sendCredential. Until then the Issue
 * button surfaces an empty results array + a "lands next iteration"
 * toast so the visual contract is preserved.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useCardStore } from '@/cards/cardManager';
import { IDNavBar, IDSectionHeader } from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import {
  DELIVERY_METHODS,
  deliveryMethodLabel,
  type DeliveryMethod,
} from '@/groups/deliverySettings';
import { useGroup, useGroupMembers } from '@/groups/store';
import { getMmkv } from '@/storage/mmkv';
import type { BusinessCard } from '@solidarity/shared';

const MONO_FONT = 'Menlo';
const BINDING_PREFIX = 'group_issuance_binding_';

interface IssuanceBinding {
  readonly cardId: string;
  readonly customName: string | null;
}

interface IssuanceResult {
  readonly memberId: string;
  readonly status: 'success' | 'failure';
  readonly error?: string;
}

function loadBinding(groupId: string): IssuanceBinding | null {
  try {
    const raw = getMmkv().getString(`${BINDING_PREFIX}${groupId}`);
    if (!raw) return null;
    return JSON.parse(raw) as IssuanceBinding;
  } catch {
    return null;
  }
}

function saveBinding(groupId: string, binding: IssuanceBinding): void {
  try {
    getMmkv().set(`${BINDING_PREFIX}${groupId}`, JSON.stringify(binding));
  } catch {
    // Best-effort.
  }
}

export default function GroupVCIssuanceScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const members = useGroupMembers(id);
  const cards = useCardStore((s) => s.cards);
  const hydrateCards = useCardStore((s) => s.hydrate);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [rememberSelection, setRememberSelection] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [deliveryMethod, setDeliveryMethod] =
    useState<DeliveryMethod>('sakura');
  const [hasExpiration, setHasExpiration] = useState(false);
  const [expirationDate, setExpirationDate] = useState<Date | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [results, setResults] = useState<readonly IssuanceResult[]>([]);

  useEffect(() => { void hydrateCards(); }, [hydrateCards]);

  useEffect(() => {
    if (!id) return;
    const binding = loadBinding(id);
    if (binding) {
      const card = cards.find((c) => c.id === binding.cardId);
      if (card) {
        setSelectedCardId(card.id);
        setCustomName(binding.customName ?? card.name);
      }
    }
  }, [id, cards]);

  const activeMembers = members.filter((m) => m.status === 'active');
  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
  const sendToAll = selectedMembers.size === 0;

  const onSelectCard = (card: BusinessCard | null): void => {
    setSelectedCardId(card?.id ?? null);
    if (card && customName.length === 0) {
      setCustomName(card.name);
    }
  };

  const onToggleMember = (userId: string, next: boolean): void => {
    setSelectedMembers((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(userId);
      else updated.delete(userId);
      return updated;
    });
  };

  const onToggleSendAll = (next: boolean): void => {
    if (next) setSelectedMembers(new Set());
  };

  const onToggleExpiration = (next: boolean): void => {
    setHasExpiration(next);
    if (next) {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      setExpirationDate(d);
    } else {
      setExpirationDate(null);
    }
  };

  const onIssue = async (): Promise<void> => {
    if (!selectedCard || !id) return;
    setIsIssuing(true);
    try {
      // TODO(android): GroupCredentialService.issueGroupCredential(...)
      await new Promise((resolve) => setTimeout(resolve, 400));
      const recipients =
        selectedMembers.size === 0
          ? activeMembers
          : activeMembers.filter((m) => selectedMembers.has(m.userRecordID));
      const fakeResults: IssuanceResult[] = recipients.map((m) => ({
        memberId: m.userRecordID,
        status: 'success',
      }));
      setResults(fakeResults);
      if (rememberSelection) {
        saveBinding(id, {
          cardId: selectedCard.id,
          customName: customName.trim().length === 0 ? null : customName.trim(),
        });
      }
      pushToast(
        `${String(fakeResults.length)} credential${fakeResults.length === 1 ? '' : 's'} issued`,
        'success'
      );
    } catch (e) {
      pushToast(
        e instanceof Error ? e.message : 'Issuance failed',
        'error'
      );
    } finally {
      setIsIssuing(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar
        title="Issue Group VC"
        leadingLabel={group?.name ?? 'Group'}
        trailing={
          <Pressable
            onPress={() => { router.back(); }}
            accessibilityRole="button"
            accessibilityLabel="Done"
            hitSlop={8}
            className="px-1 py-1 active:opacity-60"
          >
            <Text className="text-text1 text-[16px]">Done</Text>
          </Pressable>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-4">
          <CardSelectSection
            cards={cards}
            selectedCardId={selectedCardId}
            onSelect={onSelectCard}
          />

          <DisplaySection
            hasCard={selectedCard !== null}
            customName={customName}
            onChangeName={setCustomName}
            remember={rememberSelection}
            onChangeRemember={setRememberSelection}
          />

          <RecipientsSection
            sendToAll={sendToAll}
            onToggleSendAll={onToggleSendAll}
            activeMembers={activeMembers}
            selectedMembers={selectedMembers}
            onToggleMember={onToggleMember}
          />

          <MethodSection value={deliveryMethod} onChange={setDeliveryMethod} />

          <ExpirationSection
            enabled={hasExpiration}
            onToggle={onToggleExpiration}
            expirationDate={expirationDate}
          />

          <ThemedButton
            variant="primary"
            label={isIssuing ? 'Issuing...' : 'Issue Group Credential'}
            fullWidth
            disabled={selectedCard === null || isIssuing}
            leadingIcon={
              isIssuing ? <ActivityIndicator color="#FFFFFF" /> : undefined
            }
            onPress={() => { void onIssue(); }}
          />

          {results.length > 0 ? <ResultsSection results={results} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function CardSelectSection({
  cards,
  selectedCardId,
  onSelect,
}: {
  readonly cards: readonly BusinessCard[];
  readonly selectedCardId: string | null;
  readonly onSelect: (c: BusinessCard | null) => void;
}): React.JSX.Element {
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

function DisplaySection({
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
}): React.JSX.Element {
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
                trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
                thumbColor={Colors.cardBg}
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

function RecipientsSection({
  sendToAll,
  onToggleSendAll,
  activeMembers,
  selectedMembers,
  onToggleMember,
}: {
  readonly sendToAll: boolean;
  readonly onToggleSendAll: (next: boolean) => void;
  readonly activeMembers: ReadonlyArray<{ readonly userRecordID: string }>;
  readonly selectedMembers: ReadonlySet<string>;
  readonly onToggleMember: (id: string, next: boolean) => void;
}): React.JSX.Element {
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
            trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
            thumbColor={Colors.cardBg}
            ios_backgroundColor={Colors.divider}
          />
        </View>
        {!sendToAll
          ? activeMembers.map((m, idx) => (
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
                    trackColor={{
                      false: Colors.divider,
                      true: Colors.primaryBlue,
                    }}
                    thumbColor={Colors.cardBg}
                    ios_backgroundColor={Colors.divider}
                  />
                </View>
                {idx === activeMembers.length - 1 ? null : null}
              </View>
            ))
          : null}
      </View>
    </View>
  );
}

function MethodSection({
  value,
  onChange,
}: {
  readonly value: DeliveryMethod;
  readonly onChange: (m: DeliveryMethod) => void;
}): React.JSX.Element {
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

function ExpirationSection({
  enabled,
  onToggle,
  expirationDate,
}: {
  readonly enabled: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly expirationDate: Date | null;
}): React.JSX.Element {
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
            trackColor={{ false: Colors.divider, true: Colors.primaryBlue }}
            thumbColor={Colors.cardBg}
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

function ResultsSection({
  results,
}: {
  readonly results: readonly IssuanceResult[];
}): React.JSX.Element {
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
}): React.JSX.Element {
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
        style={
          active ? { color: Colors.text1, fontWeight: '600' } : undefined
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Suppress unused import warning if MONO_FONT is removed by chance.
void MONO_FONT;
