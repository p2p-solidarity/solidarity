/**
 * ContactsList — FlashList wrapper for the People tab.
 *
 * Why FlashList over FlatList:
 *   - Recycles cells (zero render churn on long scrolls), critical for the
 *     1k+ contact list we expect from Twitter / VCF importer.
 *   - Smooth gesture handoff with react-native-gesture-handler (no JS-thread
 *     scroll jitter when the gesture-triggered backup pan competes).
 *
 * Empty state, loading state, refresh action all live here so the tab
 * screen is a thin shell. Mirrors aniseekr-expo's `List` component pattern.
 */
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { PaperStackIllustration } from '@/components/decor/PaperStackIllustration';
import { ThemedSurface, ThemedText } from '@/components/themed';
import type { Contact } from '@solidarity/shared';

import { ContactRow } from './ContactRow';

export interface ContactsListProps {
  readonly contacts: readonly Contact[];
  readonly loading?: boolean;
  readonly onSelectContact: (contact: Contact) => void;
  readonly onLongPressContact?: (contact: Contact) => void;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
}

function EmptyState(): ReactNode {
  return (
    <View className="flex-1 items-center justify-center p-6">
      <View className="mb-4">
        <PaperStackIllustration size={120} />
      </View>
      <ThemedSurface variant="outlined" padded className="w-full items-center">
        <ThemedText variant="titleMedium">Your contact list is empty</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-2 text-center">
          Scan a QR or run a Radar Exchange to add your first contact.
        </ThemedText>
      </ThemedSurface>
    </View>
  );
}

function LoadingState(): ReactNode {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator />
    </View>
  );
}

export function ContactsList({
  contacts,
  loading = false,
  onSelectContact,
  onLongPressContact,
  onRefresh,
  refreshing = false,
}: ContactsListProps): ReactNode {
  const keyExtractor = useCallback((c: Contact) => c.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Contact }) => (
      <ContactRow
        contact={item}
        onPress={onSelectContact}
        onLongPress={onLongPressContact}
      />
    ),
    [onSelectContact, onLongPressContact]
  );

  if (loading && contacts.length === 0) return <LoadingState />;
  if (contacts.length === 0) return <EmptyState />;

  // FlashList v2 auto-measures item size — no `estimatedItemSize` prop.
  return (
    <FlashList
      data={contacts}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      onRefresh={onRefresh}
      refreshing={refreshing}
    />
  );
}
