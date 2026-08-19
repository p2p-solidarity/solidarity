import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { contactFromLeaveCard, useLeaveCardStore } from '@/contacts/leaveCardInbox';
import { useContactStore } from '@/contacts/repository';
import { useRecentUpdatesStore, type RecentProfileChange } from '@/contacts/recentUpdates';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';

export function ContactsActivitySections({ onContactAdded }: { readonly onContactAdded: () => void }): ReactNode {
  const { t } = useTranslation();
  const [inboxOpen, setInboxOpen] = useState(false);
  const pending = useLeaveCardStore((state) => state.pending);
  const pendingStatus = useLeaveCardStore((state) => state.status);
  const updates = useRecentUpdatesStore((state) => state.events);
  const updatesStatus = useRecentUpdatesStore((state) => state.status);
  const enabled = useRecentUpdatesStore((state) => state.enabled);
  const expanded = useRecentUpdatesStore((state) => state.expanded);
  const setEnabled = useRecentUpdatesStore((state) => state.setEnabled);
  const setExpanded = useRecentUpdatesStore((state) => state.setExpanded);

  const hasPending = pendingStatus === 'ready' && pending.length > 0;
  const hasRecentUpdates = updatesStatus === 'ready' && enabled && updates.length > 0;

  return (
    <>
      {hasPending || hasRecentUpdates ? (
        <View className="gap-3 px-4 pb-3">
          {hasPending ? (
            <PressableScale
              onPress={() => { setInboxOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel={t('peopleList.pendingReview')}
              style={{
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 14,
                borderRadius: 0,
                borderWidth: 0.5,
                borderColor: Colors.primaryMauve,
                backgroundColor: Colors.chipSurface,
              }}>
              <ThemedText variant="titleMedium">↙</ThemedText>
              <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
                {t('peopleList.pendingCount', { count: pending.length })}
              </ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary">{t('peopleList.review')} ›</ThemedText>
            </PressableScale>
          ) : null}

          {hasRecentUpdates ? (
            <View
              style={{
                overflow: 'hidden',
                borderRadius: 0,
                borderWidth: 0.5,
                borderColor: Colors.divider,
                backgroundColor: Colors.cardBg,
              }}
            >
              <View className="flex-row items-center">
                <PressableScale
                  fill
                  onPress={() => { setExpanded(!expanded); }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  className="min-h-12 flex-row items-center gap-2 px-4 py-3">
                  <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
                    {t('peopleList.recentUpdates')}
                  </ThemedText>
                  <ThemedText variant="caption" tone="tertiary">{updates.length}</ThemedText>
                  <ThemedText variant="bodyMedium" tone="tertiary">{expanded ? '⌃' : '⌄'}</ThemedText>
                </PressableScale>
                <PressableScale
                  onPress={() => { setEnabled(false); }}
                  accessibilityRole="button"
                  accessibilityLabel={t('peopleList.turnOffRecentUpdates')}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <ThemedText variant="titleMedium" tone="tertiary">×</ThemedText>
                </PressableScale>
              </View>
              {expanded ? (
                <View style={{ borderTopWidth: 0.5, borderTopColor: Colors.divider }}>
                  {updates.map((event) => (
                    <PressableScale
                      key={event.id}
                      onPress={() => {
                        router.push({ pathname: '/people/profile/[did]', params: { did: event.did } });
                      }}
                      accessibilityRole="button"
                      className="min-h-12 gap-1 px-4 py-3">
                      <ThemedText variant="bodySmall">
                        {t('peopleList.updateLine', {
                          name: event.name || t('peopleList.savedPage'),
                          changes: changeSummary(event.changes, t),
                        })}
                      </ThemedText>
                      <ThemedText variant="caption" tone="tertiary">
                        {new Date(event.occurredAt).toLocaleDateString()}
                      </ThemedText>
                    </PressableScale>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <PendingLeaveCardsSheet
        visible={inboxOpen}
        onClose={() => { setInboxOpen(false); }}
        onContactAdded={onContactAdded}
      />
    </>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function changeSummary(changes: readonly RecentProfileChange[], t: Translate): string {
  return changes.map((change) => t(`peopleList.update.${change}`)).join(t('peopleList.updateJoiner'));
}

function PendingLeaveCardsSheet({
  visible,
  onClose,
  onContactAdded,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onContactAdded: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const pending = useLeaveCardStore((state) => state.pending);
  const accept = useLeaveCardStore((state) => state.accept);
  const skip = useLeaveCardStore((state) => state.skip);
  const block = useLeaveCardStore((state) => state.block);
  const upsert = useContactStore((state) => state.upsert);
  const [savingId, setSavingId] = useState<string | null>(null);

  const addCard = (id: string): void => {
    const card = pending.find((candidate) => candidate.id === id);
    if (!card || savingId) return;
    setSavingId(id);
    void (async () => {
      try {
        await upsert(contactFromLeaveCard(card));
        if (!accept(id)) throw new Error('Could not remove pending card');
        haptic('success');
        pushToast(t('peopleList.cardAdded', { name: card.name }), 'success');
        onContactAdded();
      } catch {
        haptic('error');
        pushToast(t('peopleList.cardAddFailed'), 'error');
      } finally {
        setSavingId(null);
      }
    })();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
          <View className="flex-row items-center justify-between">
            <ThemedText variant="titleLarge">{t('peopleList.pendingTitle')}</ThemedText>
            <ThemedButton label={t('common.close')} size="sm" variant="secondary" onPress={onClose} />
          </View>

          {pending.length === 0 ? (
            <View
              className="items-center gap-2 py-8"
              style={{ borderRadius: 0, borderWidth: 0.5, borderColor: Colors.divider }}
            >
              <ThemedText variant="titleMedium">{t('peopleList.noCardsPending')}</ThemedText>
              <ThemedText variant="bodySmall" tone="secondary" style={{ textAlign: 'center' }}>
                {t('peopleList.noCardsPendingBody')}
              </ThemedText>
            </View>
          ) : pending.map((card) => (
            <View
              key={card.id}
              className="gap-3 p-4"
              style={{ borderRadius: 0, borderWidth: 0.5, borderColor: Colors.divider }}
            >
              <View className="gap-1">
                <ThemedText variant="bodyMedium">{card.name}</ThemedText>
                <ThemedText variant="bodySmall" tone="secondary">{card.contact}</ThemedText>
                {card.message ? <ThemedText variant="caption" tone="secondary">{card.message}</ThemedText> : null}
              </View>
              <View className="flex-row flex-wrap gap-2">
                <ThemedButton
                  label={t('peopleList.pendingAdd')}
                  size="sm"
                  loading={savingId === card.id}
                  onPress={() => { addCard(card.id); }}
                />
                <ThemedButton
                  label={t('peopleList.pendingSkip')}
                  size="sm"
                  variant="secondary"
                  disabled={savingId !== null}
                  onPress={() => { skip(card.id); }}
                />
                <ThemedButton
                  label={t('peopleList.pendingBlock')}
                  size="sm"
                  variant="destructive"
                  disabled={savingId !== null}
                  onPress={() => { block(card.id); }}
                />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
