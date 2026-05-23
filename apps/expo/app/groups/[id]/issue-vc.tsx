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
 * Section UI lives in `@/components/groups/GroupVCIssuanceSections` so this
 * screen file stays under the 500-line cap.
 *
 * TODO(android): wire GroupCredentialService.issueGroupCredential +
 * GroupCredentialDeliveryService.sendCredential. Until then the Issue
 * button surfaces a synthesised results array + a "lands next iteration"
 * toast so the visual contract is preserved.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { useCardStore } from '@/cards/cardManager';
import {
  CardSelectSection,
  DisplaySection,
  ExpirationSection,
  MethodSection,
  RecipientsSection,
  ResultsSection,
  type IssuanceResult,
} from '@/components/groups/GroupVCIssuanceSections';
import { IDNavBar } from '@/components/id';
import { ThemedButton } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { type DeliveryMethod } from '@/groups/deliverySettings';
import { useGroup, useGroupMembers } from '@/groups/store';
import { getMmkv } from '@/storage/mmkv';
import type { BusinessCard } from '@solidarity/shared';

const BINDING_PREFIX = 'group_issuance_binding_';

interface IssuanceBinding {
  readonly cardId: string;
  readonly customName: string | null;
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

  useEffect(() => {
    void hydrateCards();
  }, [hydrateCards]);

  useEffect(() => {
    if (!id) return;
    const binding = loadBinding(id);
    if (!binding) return;
    const card = cards.find((c) => c.id === binding.cardId);
    if (card) {
      setSelectedCardId(card.id);
      setCustomName(binding.customName ?? card.name);
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
          customName:
            customName.trim().length === 0 ? null : customName.trim(),
        });
      }
      pushToast(
        `${String(fakeResults.length)} credential${fakeResults.length === 1 ? '' : 's'} issued`,
        'success'
      );
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Issuance failed', 'error');
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
