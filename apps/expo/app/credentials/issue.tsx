/**
 * Issue Group VC — port of solidarity/Views/IDViews/GroupVCIssuanceView.swift.
 *
 * Sections (Swift parity): SELECT BUSINESS CARD, GROUP DISPLAY, RECIPIENTS,
 * DELIVERY METHOD, EXPIRATION (OPTIONAL), Issue button, RESULTS. Section
 * headers are 12pt monospaced bold uppercase text3; field cards are
 * searchBg with 1pt divider overlay.
 *
 * NOTE on the OIDC wave: this screen is the in-app group-VC ceremony
 * (Swift `GroupCredentialService`), not an OID4VCI issuer endpoint. The
 * OID4VCI ceremony lives in `app/credentials/offer.tsx` + the matching
 * services in `src/oidc/`. Real group-issuance signing still lives in
 * `GroupCredentialService` — when that lands as `src/credentials/groupIssuance.ts`,
 * swap the body of `runIssuance` below.
 */
import { router, useLocalSearchParams } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { useCardStore } from '@/cards/cardManager';
import { PressableScale } from '@/components/common/PressableScale';
import {
  ON_DARK,
  ThemedButton,
  ThemedSurface,
  ThemedText,
  ThemedTextInput,
} from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useCredentialStore } from '@/credentials/store';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useGroup, useGroupMembers } from '@/groups/store';
import { getMmkv } from '@/storage/mmkv';
import type { CardManifestEntry } from '@/cards/cardManifest';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type DeliveryMethod = 'Sakura' | 'Proximity' | 'QR Code' | 'AirDrop';
const DELIVERY_METHODS: readonly DeliveryMethod[] = ['Sakura', 'Proximity', 'QR Code', 'AirDrop'];

interface GroupCardBindingSettings {
  readonly cardId: string;
  readonly customName?: string;
}

function bindingKey(groupId: string): string {
  return `group_issuance_binding_${groupId}`;
}
function loadBinding(groupId: string): GroupCardBindingSettings | null {
  const raw = getMmkv().getString(bindingKey(groupId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GroupCardBindingSettings;
  } catch {
    return null;
  }
}
function saveBinding(groupId: string, settings: GroupCardBindingSettings): void {
  getMmkv().set(bindingKey(groupId), JSON.stringify(settings));
}

type IssuanceResult =
  | { readonly ok: true; readonly memberId: string }
  | { readonly ok: false; readonly memberId: string; readonly error: string };

function thirtyDaysFromNow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

// MARK: - Atoms

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View>
      <ThemedText
        variant="label"
        tone="tertiary"
        style={{
          fontFamily: MONO,
          marginBottom: 8,
        }}>
        {title}
      </ThemedText>
      <ThemedSurface
        variant="inset"
        className="overflow-hidden rounded-none"
        style={{ borderWidth: 1, borderColor: Colors.divider }}>
        {children}
      </ThemedSurface>
    </View>
  );
}

function SegmentedOption({
  label,
  isSelected,
  onPress,
}: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: isSelected ? Colors.text1 : 'transparent',
      }}>
      <ThemedText
        variant="bodySmall"
        style={{
          color: isSelected ? Colors.pageBg : Colors.text1,
          fontWeight: isSelected ? '600' : '400',
        }}>
        {label}
      </ThemedText>
    </PressableScale>
  );
}

function SegmentedRow({ children }: { readonly children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: Colors.searchBg }}
      contentContainerStyle={{ padding: 8, gap: 6 }}>
      {children}
    </ScrollView>
  );
}

function ToggleRow({
  label,
  isOn,
  onChange,
}: {
  readonly label: string;
  readonly isOn: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <PressableScale
      onPress={() => {
        onChange(!isOn);
      }}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: isOn }}
      style={{
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}>
      <ThemedText variant="bodySmall" style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <View
        style={{
          width: 36,
          height: 22,
          borderRadius: 11,
          backgroundColor: isOn ? Colors.primaryBlue : Colors.divider,
          padding: 2,
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: ON_DARK,
            alignSelf: isOn ? 'flex-end' : 'flex-start',
          }}
        />
      </View>
    </PressableScale>
  );
}

function ResultRow({
  result,
  t,
}: {
  readonly result: IssuanceResult;
  readonly t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const icon: SFSymbol = result.ok ? 'checkmark.circle.fill' : 'xmark.circle.fill';
  const color = result.ok ? Colors.terminalGreen : Colors.destructive;
  const label = result.ok
    ? t('groupIssue.resultSent', { member: result.memberId })
    : t('groupIssue.resultFailed', { member: result.memberId, error: result.error });
  return (
    <ThemedSurface
      variant="inset"
      className="rounded-none"
      style={{
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}>
      <SfIcon name={icon} size={14} color={color} />
      <ThemedText variant="bodySmall" style={{ color, flex: 1 }}>
        {label}
      </ThemedText>
    </ThemedSurface>
  );
}

// MARK: - Screen

export default function GroupVCIssuanceScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const group = useGroup(groupId);
  const members = useGroupMembers(groupId);
  const cards = useCardStore((s) => s.manifest);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const addCredential = useCredentialStore((s) => s.add);

  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(undefined);
  const [customName, setCustomName] = useState('');
  const [rememberSelection, setRememberSelection] = useState(true);
  const [selectedMemberIds, setSelectedMemberIds] = useState<readonly string[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('Sakura');
  const [expirationDate, setExpirationDate] = useState<Date | undefined>(undefined);
  const [isIssuing, setIsIssuing] = useState(false);
  const [results, setResults] = useState<readonly IssuanceResult[]>([]);

  useEffect(() => {
    void hydrateCards();
  }, [hydrateCards]);

  useEffect(() => {
    if (!groupId) return;
    const saved = loadBinding(groupId);
    if (!saved) return;
    const card = cards.find((c) => c.id === saved.cardId);
    if (card) {
      setSelectedCardId(card.id);
      setCustomName(saved.customName ?? card.name);
    }
  }, [groupId, cards]);

  const selectedCard = useMemo<CardManifestEntry | undefined>(
    () => cards.find((c) => c.id === selectedCardId),
    [cards, selectedCardId]
  );

  const sendToAllMembers = selectedMemberIds.length === 0;

  const toggleMember = (memberId: string, on: boolean) => {
    setSelectedMemberIds((prev) => {
      const next = prev.filter((id) => id !== memberId);
      return on ? [...next, memberId] : next;
    });
  };

  const runIssuance = async () => {
    if (!selectedCard || !group) return;
    setIsIssuing(true);

    const targetMembers =
      selectedMemberIds.length === 0
        ? members
        : members.filter((m) => selectedMemberIds.includes(m.userRecordID));

    const trimmed = customName.trim();
    const nameOverride: string | undefined = trimmed.length === 0 ? undefined : trimmed;

    const placeholderId = `${group.id}-${selectedCard.id}-${Date.now()}`;
    await addCredential({
      id: placeholderId,
      type: 'group_membership',
      title: nameOverride ?? `${group.name} member`,
      issuerDid: `did:web:solidarity.gg/group/${group.id}`,
      holderDid: 'did:key:me',
      trustLevel: 'L2',
      rawJwt: 'unsigned.placeholder.jwt',
      issuedAt: new Date(),
      expiresAt: expirationDate,
      metadataTags: [deliveryMethod.toLowerCase()],
    });

    const issuanceResults: IssuanceResult[] =
      targetMembers.length === 0
        ? [{ ok: true, memberId: 'self' }]
        : targetMembers.map((m) => ({ ok: true, memberId: m.userRecordID }));

    if (rememberSelection) {
      saveBinding(group.id, { cardId: selectedCard.id, customName: nameOverride });
    }

    setResults(issuanceResults);
    setIsIssuing(false);
    pushToast(t('groupIssue.issuedToast'), 'success');
  };

  if (!group || !groupId) {
    return (
      <View className="flex-1 items-center justify-center bg-pageBg">
        <ThemedText variant="bodyMedium" tone="secondary">
          {t('groupIssue.notFound')}
        </ThemedText>
      </View>
    );
  }

  const issueDisabled = selectedCard === undefined || isIssuing;

  return (
    <View className="flex-1 bg-pageBg">
      <View style={{ paddingTop: insets.top }} className="bg-pageBg">
        <View className="h-11 flex-row items-center px-4">
          <View style={{ width: 50 }} />
          <View className="flex-1 items-center">
            <ThemedText variant="titleMedium">{t('groupIssue.title')}</ThemedText>
          </View>
          <PressableScale
            onPress={() => {
              router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('groupIssue.done')}
            className="px-1 py-1">
            <ThemedText variant="bodyLarge">{t('groupIssue.done')}</ThemedText>
          </PressableScale>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Section title={t('groupIssue.selectCardHeader')}>
          <SegmentedRow>
            <SegmentedOption
              label={t('groupIssue.cardNone')}
              isSelected={selectedCardId === undefined}
              onPress={() => {
                setSelectedCardId(undefined);
              }}
            />
            {cards.map((card) => (
              <SegmentedOption
                key={card.id}
                label={card.name}
                isSelected={selectedCardId === card.id}
                onPress={() => {
                  setSelectedCardId(card.id);
                  if (customName.length === 0) setCustomName(card.name);
                }}
              />
            ))}
          </SegmentedRow>
        </Section>

        <Section title={t('groupIssue.groupDisplayHeader')}>
          <View style={{ gap: 1 }}>
            {selectedCard ? (
              <>
                <View style={{ padding: 16 }}>
                  <ThemedTextInput
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder={t('groupIssue.namePlaceholder')}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                </View>
                <ToggleRow
                  label={t('groupIssue.rememberCard')}
                  isOn={rememberSelection}
                  onChange={setRememberSelection}
                />
              </>
            ) : (
              <View style={{ padding: 16 }}>
                <ThemedText variant="bodySmall" tone="secondary">
                  {t('groupIssue.selectCardFirst')}
                </ThemedText>
              </View>
            )}
          </View>
        </Section>

        <Section title={t('groupIssue.recipientsHeader')}>
          <View style={{ gap: 1 }}>
            <ToggleRow
              label={t('groupIssue.sendToAll')}
              isOn={sendToAllMembers}
              onChange={(on) => {
                if (on) setSelectedMemberIds([]);
              }}
            />
            {!sendToAllMembers
              ? members.map((member) => (
                  <ToggleRow
                    key={member.userRecordID}
                    label={member.userRecordID}
                    isOn={selectedMemberIds.includes(member.userRecordID)}
                    onChange={(on) => {
                      toggleMember(member.userRecordID, on);
                    }}
                  />
                ))
              : null}
          </View>
        </Section>

        <Section title={t('groupIssue.deliveryHeader')}>
          <SegmentedRow>
            {DELIVERY_METHODS.map((method) => (
              <SegmentedOption
                key={method}
                label={method}
                isSelected={deliveryMethod === method}
                onPress={() => {
                  setDeliveryMethod(method);
                }}
              />
            ))}
          </SegmentedRow>
        </Section>

        <Section title={t('groupIssue.expirationHeader')}>
          <View style={{ gap: 1 }}>
            <ToggleRow
              label={t('groupIssue.setExpiration')}
              isOn={expirationDate !== undefined}
              onChange={(on) => {
                setExpirationDate(on ? thirtyDaysFromNow() : undefined);
              }}
            />
            {expirationDate ? (
              <View
                style={{
                  backgroundColor: Colors.searchBg,
                  paddingHorizontal: 16,
                  paddingVertical: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}>
                <ThemedText variant="bodySmall" style={{ flex: 1 }}>
                  {t('groupIssue.expires')}
                </ThemedText>
                <ThemedText variant="bodySmall">{expirationDate.toLocaleDateString()}</ThemedText>
              </View>
            ) : null}
          </View>
        </Section>

        <ThemedButton
          label={isIssuing ? t('groupIssue.issuing') : t('groupIssue.issueCredential')}
          fullWidth
          loading={isIssuing}
          disabled={issueDisabled}
          onPress={() => {
            void runIssuance();
          }}
        />

        {results.length > 0 ? (
          <Section title={t('groupIssue.resultsHeader')}>
            <View style={{ gap: 1 }}>
              {results.map((r, idx) => (
                <ResultRow key={`${r.memberId}-${idx}`} result={r} t={t} />
              ))}
            </View>
          </Section>
        ) : null}

        <View style={{ height: 8 + insets.bottom }} />
      </ScrollView>
    </View>
  );
}
