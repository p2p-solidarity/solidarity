/**
 * Edit / Create business card — 1:1 port of
 * solidarity/Views/CardViews/BusinessCardFormView.swift.
 *
 * Keeps profileImage read-only (Swift parity — profile photos are sourced
 * from OCR / received-card flows, not the manual editor). Only the animal
 * theme is editable here, via AnimalSelectorGrid above the form.
 *
 * Header: chevron.left + "Cancel" leading, centred title that flips between
 * "Edit Identity Card" and "Create Identity Card" — verbatim Swift copy.
 */
import { useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore } from '@/cards/cardManager';
import { AnimalSelectorGrid, BusinessCardForm } from '@/components/cards';
import { SfIcon } from '@/components/icons/SfIcon';
import { PressableScale } from '@/components/common/PressableScale';
import { appAlert, showError } from '@/feedback/appAlert';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  type Animal,
  type BusinessCard,
  type GroupCredentialContext,
} from '@solidarity/shared';

const NEW_ID = '00000000-0000-0000-0000-000000000000';

export default function EditCardScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const loadDetail = useCardStore((s) => s.loadDetail);
  const detailsById = useCardStore((s) => s.details);
  const upsert = useCardStore((s) => s.upsert);
  const remove = useCardStore((s) => s.remove);

  const targetId = id && id !== NEW_ID ? id : undefined;
  const targetCard = targetId ? detailsById.get(targetId) : undefined;

  useEffect(() => {
    if (targetId) void loadDetail(targetId);
  }, [targetId, loadDetail]);

  const isEditing = targetCard !== undefined;

  const [animal, setAnimal] = useState<Animal | undefined>(targetCard?.animal);
  // Work / group presentation context (Swift BusinessCard.groupContext).
  // Editable here only insofar as the user can RESET it to personal — a real
  // `.group(info)` context is established by the group-VC issuance flow that
  // supplies the genuine merkleRoot / issuedBy, never fabricated in the form.
  const [groupContext, setGroupContext] = useState<
    GroupCredentialContext | undefined
  >(targetCard?.groupContext);

  useEffect(() => {
    setAnimal(targetCard?.animal);
    setGroupContext(targetCard?.groupContext);
  }, [targetCard]);

  const handleSave = useCallback(
    async (card: BusinessCard) => {
      const merged: BusinessCard = { ...card, animal, groupContext };
      const result = await upsert(merged);
      if (!result.ok) {
        appAlert({ title: t('cardEdit.errorTitle'), message: result.error.message });
        haptic('error');
        return;
      }
      haptic('success');
      pushToast(isEditing ? 'Card saved' : 'Card created', 'success');
      safeBack();
    },
    [animal, groupContext, isEditing, upsert, t]
  );

  const handleDelete = useCallback(async () => {
    if (!targetCard) return;
    try {
      await remove(targetCard.id);
      haptic('warning');
      pushToast(t('cardsList.deleted'), 'info');
      safeBack();
    } catch (error) {
      haptic('error');
      showError({
        context: 'Cards › Delete Card',
        summary: t('cardsList.deleteFailed'),
        error,
      });
    }
  }, [remove, targetCard, t]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Header
        title={isEditing ? 'Edit Identity Card' : 'Create Identity Card'}
        onCancel={() => {
          safeBack();
        }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingTop: 24,
          paddingBottom: insets.bottom + 48,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 24 }}>
          <AnimalBlock
            animal={animal}
            onChangeAnimal={(next) => {
              setAnimal(next);
              haptic('selection');
            }}
          />

          <WorkContextBlock
            groupContext={groupContext}
            onResetToPersonal={() => {
              setGroupContext({ type: 'personal' });
              haptic('selection');
            }}
          />

          <BusinessCardForm
            initialCard={targetCard}
            onSave={handleSave}
            onDelete={isEditing ? handleDelete : undefined}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// MARK: - Header (Swift SettingsBackToolbar parity)

function Header({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        paddingHorizontal: 8,
      }}
    >
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        hitSlop={8}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 8,
        }}
      >
        <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
        <Text style={{ fontSize: 16, color: Colors.text1 }}>Cancel</Text>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 17, fontWeight: '600', color: Colors.text1 }}
        >
          {title}
        </Text>
      </View>
      {/* Trailing spacer to balance the leading button so the title centres. */}
      <View style={{ width: 80 }} />
    </View>
  );
}

// MARK: - Animal selector block

function AnimalBlock({
  animal,
  onChangeAnimal,
}: {
  animal: Animal | undefined;
  onChangeAnimal: (next: Animal) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text className="text-text1 text-[14px]" style={{ paddingHorizontal: 16 }}>
        Theme
      </Text>
      <View style={{ paddingHorizontal: 16 }}>
        <AnimalSelectorGrid selection={animal} onChange={onChangeAnimal} />
      </View>
    </View>
  );
}

// MARK: - Work context block (Swift BusinessCard.groupContext)

/**
 * Surfaces the card's work / group presentation context. When the card is
 * bound to a group (`.group(info)`) it shows the group name and a control to
 * detach (back to personal). It deliberately offers NO way to *attach* a
 * group here: a real `.group` context carries the issuing group's merkleRoot
 * and issuedBy, which only the group-VC issuance flow can supply — entering
 * them by hand would be fabricated data (CLAUDE.md rule 8).
 */
function WorkContextBlock({
  groupContext,
  onResetToPersonal,
}: {
  groupContext: GroupCredentialContext | undefined;
  onResetToPersonal: () => void;
}) {
  const { t } = useTranslation();
  const isGroup = groupContext?.type === 'group';
  return (
    <View style={{ gap: 8 }}>
      <Text className="text-text1 text-[14px]" style={{ paddingHorizontal: 16 }}>
        {t('cardEdit.workContext')}
      </Text>
      <View
        className="bg-mutedSurface flex-row items-center gap-2 rounded-lg px-3 py-4"
        style={{ marginHorizontal: 16 }}
      >
        <SfIcon
          name={isGroup ? 'briefcase' : 'person.fill'}
          size={14}
          color={isGroup ? Colors.terminalGreen : Colors.text3}
        />
        <View className="flex-1">
          <Text className="text-text1 text-[15px]">
            {isGroup && groupContext.type === 'group'
              ? groupContext.info.groupName
              : t('cardEdit.workContextPersonal')}
          </Text>
          <Text className="text-text3 text-[11px]">
            {isGroup
              ? t('cardEdit.workContextGroupHint')
              : t('cardEdit.workContextPersonalHint')}
          </Text>
        </View>
        {isGroup ? (
          <PressableScale
            haptic="tap"
            onPress={onResetToPersonal}
            accessibilityRole="button"
            accessibilityLabel={t('cardEdit.workContextReset')}
            className="rounded-sm2"
            style={{
              minWidth: 56,
              minHeight: 28,
              backgroundColor: Colors.invertedButtonBg,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
            }}
          >
            <Text style={{ color: Colors.pageBg }} className="text-[13px] font-medium">
              {t('cardEdit.workContextReset')}
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}
