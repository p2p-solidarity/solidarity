/**
 * My Cards — 1:1 port of
 * solidarity/Views/CardViews/BusinessCardListView.swift.
 *
 * Lists every saved business card. Empty state mirrors Swift
 * BusinessCardEmptyStateView (paper stack illustration + headline +
 * "Create Card" primary button). Filled state renders BusinessCardRow
 * rows; tap routes into /cards/edit?id=… for editing. The trailing
 * "+" header button routes into the same edit screen with no id so
 * the form opens in create mode.
 *
 * Routing note: this screen is reachable via /cards (entry points wire
 * up in a later wave — Me tab / Quick actions). Not linked from
 * (tabs)/me/index.tsx per scope rules.
 */
import { router, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CardManifestEntry } from '@/cards/cardManifest';
import { useCardStore } from '@/cards/cardManager';
import { BusinessCardActionsSheet, BusinessCardRow } from '@/components/cards';
import { PaperStackIllustration } from '@/components/decor/PaperStackIllustration';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';

export default function CardsIndexScreen(): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const hydrate = useCardStore((s) => s.hydrate);
  const manifest = useCardStore((s) => s.manifest);
  const detailsHydrated = useCardStore((s) => s.detailsHydrated);
  const remove = useCardStore((s) => s.remove);

  const [actionsCard, setActionsCard] = useState<CardManifestEntry | undefined>();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const goCreate = (): void => {
    router.push('/cards/edit');
  };

  const goEdit = (card: CardManifestEntry): void => {
    haptic('selection');
    router.push({ pathname: '/cards/edit', params: { id: card.id } });
  };

  const goWalletPass = (card: CardManifestEntry): void => {
    router.push({ pathname: '/cards/wallet-pass', params: { id: card.id } });
  };

  const onShare = (card: CardManifestEntry): void => {
    void Share.share({ message: t('cardsList.shareMessage', { name: card.name }) }).catch(
      () => undefined
    );
  };

  const onDelete = (card: CardManifestEntry): void => {
    void remove(card.id);
  };

  // Rule 10: when the manifest is already populated (warm start) we paint
  // rows on frame 1. The skeleton only appears on truly cold launches
  // where MMKV has never held cards (e.g. fresh install pre-onboarding).
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />

      <Header onAdd={goCreate} t={t} />

      {manifest.length === 0 ? (
        detailsHydrated ? (
          <EmptyState onCreate={goCreate} t={t} />
        ) : (
          <Loading />
        )
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingVertical: 12, paddingBottom: insets.bottom + 24 }}>
          {manifest.map((card) => (
            <BusinessCardRow
              key={card.id}
              card={card}
              onPress={goEdit}
              onLongPress={(c) => {
                setActionsCard(c);
              }}
            />
          ))}
        </ScrollView>
      )}

      <BusinessCardActionsSheet
        visible={actionsCard !== undefined}
        card={actionsCard}
        onClose={() => {
          setActionsCard(undefined);
        }}
        onEdit={goEdit}
        onWalletPass={goWalletPass}
        onShare={onShare}
        onDelete={onDelete}
      />
    </View>
  );
}

function Header({
  onAdd,
  t,
}: {
  readonly onAdd: () => void;
  readonly t: (key: string) => string;
}): ReactNode {
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ height: 44, paddingHorizontal: 16 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('cardsList.back')}
        onPress={() => {
          router.back();
        }}
        hitSlop={8}>
        <SfIcon name="chevron.left" size={24} color={Colors.text1} />
      </Pressable>

      <ThemedText variant="titleMedium" numberOfLines={1}>
        {t('cardsList.title')}
      </ThemedText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('cardsList.addCard')}
        onPress={onAdd}
        hitSlop={8}
        style={{ width: 24, alignItems: 'flex-end' }}>
        <SfIcon name="plus" size={22} weight="semibold" color={Colors.text1} />
      </Pressable>
    </View>
  );
}

function Loading(): ReactNode {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator color={Colors.text1} />
    </View>
  );
}

function EmptyState({
  onCreate,
  t,
}: {
  readonly onCreate: () => void;
  readonly t: (key: string) => string;
}): ReactNode {
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ rowGap: 32, paddingHorizontal: 32 }}>
      <PaperStackIllustration size={160} />

      <View style={{ rowGap: 12, alignItems: 'center' }}>
        <ThemedText variant="headlineMedium" style={{ textAlign: 'center' }}>
          {t('cardsList.emptyTitle')}
        </ThemedText>
        <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
          {t('cardsList.emptySubtitle')}
        </ThemedText>
      </View>

      <ThemedButton
        label={t('cardsList.createCard')}
        variant="primary"
        onPress={onCreate}
        leadingIcon={<SfIcon name="plus.circle.fill" size={16} color={Colors.cardBg} />}
      />
    </View>
  );
}
