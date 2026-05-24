/**
 * Shoutouts gallery — 1:1 port of solidarity/Views/ShoutoutViews/ShoutoutView.swift.
 *
 * Layout (Swift parity):
 *   • DecorativeBlobs background, offset top-left.
 *   • Header: SakuraIcon + "Sakura Ichigoichie" + grid/list toggle + refresh
 *     + live count ("N cards").
 *   • Search bar with magnifying-glass + clear + filter menu, gradient border.
 *   • Grid (2-col) or list of contact "ShoutoutUser" rows derived from the
 *     contact repository (mirrors ShoutoutChartService.users mapping).
 *   • Floating sakura compose FAB (bottom-right) → /shoutouts/new.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SakuraIcon } from '@/components/brand/SakuraIcon';
import { DecorativeBlobs } from '@/components/decor/DecorativeBlobs';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  EMPTY_SHOUTOUT_FILTERS,
  ShoutoutFiltersSheet,
  type ShoutoutFiltersState,
} from '@/components/shoutouts/ShoutoutFiltersSheet';
import { Colors } from '@/constants/Colors';
import { useContactList } from '@/contacts/repository';
import { haptic } from '@/feedback/haptics';
import {
  initials,
  relativeDate,
  verificationColor,
  verificationIcon,
} from '@/shoutouts/ui';
import type { Contact } from '@solidarity/shared';

type DisplayMode = 'grid' | 'list';
type FilterOption = 'All Cards' | 'Verified Only' | 'Recently Added';

const FILTER_OPTIONS: readonly FilterOption[] = [
  'All Cards',
  'Verified Only',
  'Recently Added',
];

function GridCard({
  contact,
  onPress,
}: {
  readonly contact: Contact;
  readonly onPress: () => void;
}): ReactNode {
  const { businessCard: card } = contact;
  const subtitle = [card.title, card.company].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.name}`}
      style={{ flex: 1, minWidth: '47%', height: 180 }}
      className="bg-cardBg rounded-lg border border-divider p-3"
    >
      <View className="flex-row items-center justify-between">
        <View
          className="bg-text1 items-center justify-center"
          style={{ width: 32, height: 32, borderRadius: 16 }}
        >
          <Text className="text-cardBg" style={{ fontSize: 12, fontWeight: '700' }}>
            {initials(card.name)}
          </Text>
        </View>
        <Text className="text-text3" style={{ fontSize: 10 }}>
          {relativeDate(contact.lastInteraction ?? contact.receivedAt)}
        </Text>
      </View>
      <View style={{ marginTop: 8 }}>
        <Text
          className="text-text1"
          numberOfLines={1}
          style={{ fontSize: 16, fontWeight: '500' }}
        >
          {card.name}
        </Text>
        {subtitle ? (
          <Text
            className="text-text2"
            numberOfLines={1}
            style={{ fontSize: 14, marginTop: 4 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }} />
      <View className="flex-row items-center">
        <SfIcon
          name={verificationIcon(contact.verificationStatus)}
          size={12}
          color={verificationColor(contact.verificationStatus)}
        />
        <Text className="text-text3" style={{ fontSize: 10, marginLeft: 4 }}>
          {contact.verificationStatus}
        </Text>
      </View>
    </Pressable>
  );
}

function ListRow({
  contact,
  onPress,
}: {
  readonly contact: Contact;
  readonly onPress: () => void;
}): ReactNode {
  const { businessCard: card } = contact;
  const subtitle = [card.title, card.company].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.name}`}
    >
      <View style={{ height: 0.5, backgroundColor: Colors.divider }} />
      <View className="flex-row" style={{ paddingVertical: 12 }}>
        <View
          className="bg-text1 items-center justify-center"
          style={{ width: 32, height: 32, borderRadius: 16, marginRight: 6 }}
        >
          <Text className="text-cardBg" style={{ fontSize: 12, fontWeight: '700' }}>
            {initials(card.name)}
          </Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between">
            <View className="flex-1" style={{ marginRight: 8 }}>
              <Text
                className="text-text1"
                numberOfLines={1}
                style={{ fontSize: 16, fontWeight: '500' }}
              >
                {card.name}
              </Text>
              {subtitle ? (
                <Text
                  className="text-text2"
                  numberOfLines={1}
                  style={{ fontSize: 14, marginTop: 2 }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View className="items-end">
              <Text className="text-text3" style={{ fontSize: 10 }}>
                {relativeDate(contact.lastInteraction ?? contact.receivedAt)}
              </Text>
              <SfIcon
                name={verificationIcon(contact.verificationStatus)}
                size={10}
                color={verificationColor(contact.verificationStatus)}
              />
            </View>
          </View>
          <View
            style={{
              height: 0.5,
              backgroundColor: Colors.divider,
              marginVertical: 8,
            }}
          />
          <Text className="text-text3" numberOfLines={1} style={{ fontSize: 11 }}>
            {(card.company?.length ?? 0) > 0 ? card.company : contact.verificationStatus}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function ShoutoutsHub(): ReactNode {
  const insets = useSafeAreaInsets();
  const contacts = useContactList();
  const [searchQuery, setSearchQuery] = useState('');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('grid');
  const [filterOption, setFilterOption] = useState<FilterOption>('All Cards');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showFiltersSheet, setShowFiltersSheet] = useState(false);
  const [sheetFilters, setSheetFilters] = useState<ShoutoutFiltersState>(
    EMPTY_SHOUTOUT_FILTERS
  );
  const [isSakuraAnimating, setIsSakuraAnimating] = useState(false);

  useEffect(() => {
    setIsSakuraAnimating(true);
  }, []);

  const filtered = useMemo<readonly Contact[]>(() => {
    let list = contacts;
    if (filterOption === 'Verified Only') {
      list = list.filter((c) => c.verificationStatus === 'Verified');
    } else if (filterOption === 'Recently Added') {
      list = [...list].sort(
        (a, b) =>
          (b.lastInteraction ?? b.receivedAt).getTime() -
          (a.lastInteraction ?? a.receivedAt).getTime()
      );
    }
    if (searchQuery.length > 0) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => {
        const card = c.businessCard;
        return (
          card.name.toLowerCase().includes(q) ||
          (card.company?.toLowerCase().includes(q) ?? false) ||
          (card.title?.toLowerCase().includes(q) ?? false)
        );
      });
    }
    return list;
  }, [contacts, filterOption, searchQuery]);

  const onSelect = (contact: Contact): void => {
    haptic('tap');
    router.push({
      pathname: '/shoutouts/[id]' as const,
      params: { id: contact.id, name: contact.businessCard.name },
    });
  };

  const onRefresh = (): void => {
    haptic('selection');
    setSearchQuery('');
    setFilterOption('All Cards');
    setSheetFilters(EMPTY_SHOUTOUT_FILTERS);
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: -80, top: -120 }}
      >
        <DecorativeBlobs />
      </View>

      <View className="px-4" style={{ paddingTop: 16 }}>
        <View className="flex-row items-center">
          <SakuraIcon size={28} color={Colors.accentRose} animating={isSakuraAnimating} />
          <Text
            className="text-text1"
            style={{ marginLeft: 8, fontSize: 22, fontWeight: '700' }}
          >
            Sakura Ichigoichie
          </Text>
          <View style={{ flex: 1 }} />

          <View
            className="bg-searchBg flex-row"
            style={{ borderRadius: 8, overflow: 'hidden' }}
          >
            <Pressable
              onPress={() => { setDisplayMode('grid'); }}
              accessibilityRole="button"
              accessibilityLabel="Grid view"
              style={{
                padding: 8,
                backgroundColor:
                  displayMode === 'grid' ? `${Colors.accentRose}33` : 'transparent',
              }}
            >
              <SfIcon name="square.grid.2x2" size={14} color={Colors.text1} />
            </Pressable>
            <Pressable
              onPress={() => { setDisplayMode('list'); }}
              accessibilityRole="button"
              accessibilityLabel="List view"
              style={{
                padding: 8,
                backgroundColor:
                  displayMode === 'list' ? `${Colors.accentRose}33` : 'transparent',
              }}
            >
              <SfIcon name="list.bullet" size={14} color={Colors.text1} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => {
              haptic('tap');
              setSheetFilters((prev) => ({ ...prev, searchQuery }));
              setShowFiltersSheet(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Open filters"
            style={{ marginLeft: 8, padding: 4 }}
          >
            <SfIcon
              name="line.3.horizontal.decrease.circle"
              size={20}
              color={Colors.text1}
            />
          </Pressable>

          <Pressable
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            style={{ marginLeft: 8, padding: 4 }}
          >
            <SfIcon name="arrow.triangle.2.circlepath" size={20} color={Colors.text1} />
          </Pressable>
        </View>

        <View className="flex-row items-center" style={{ marginTop: 4, marginLeft: 36 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: Colors.terminalGreen,
            }}
          />
          <Text className="text-text2" style={{ fontSize: 12, marginLeft: 6 }}>
            {String(filtered.length)} cards
          </Text>
        </View>
      </View>

      <View className="px-4" style={{ marginTop: 12 }}>
        <View
          className="bg-searchBg flex-row items-center"
          style={{
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: `${Colors.accentRose}80`,
          }}
        >
          <SfIcon name="magnifyingglass" size={14} color={Colors.accentRose} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search contacts, companies..."
            placeholderTextColor={Colors.text3}
            style={{ flex: 1, marginLeft: 8, color: Colors.text1, fontSize: 15 }}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              onPress={() => { setSearchQuery(''); }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <SfIcon name="xmark.circle.fill" size={14} color={Colors.text2} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => { setShowFilterMenu((v) => !v); }}
            accessibilityRole="button"
            accessibilityLabel="Filter options"
            style={{ marginLeft: 12 }}
          >
            <View className="flex-row items-center">
              <SfIcon
                name="line.3.horizontal.decrease.circle"
                size={12}
                color={Colors.text2}
              />
              <Text className="text-text2" style={{ fontSize: 12, marginLeft: 4 }}>
                {filterOption}
              </Text>
            </View>
          </Pressable>
        </View>

        {showFilterMenu ? (
          <View
            className="bg-cardBg"
            style={{
              marginTop: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: Colors.divider,
              overflow: 'hidden',
            }}
          >
            {FILTER_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                onPress={() => {
                  setFilterOption(opt);
                  setShowFilterMenu(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={opt}
                className="active:opacity-80"
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  backgroundColor:
                    opt === filterOption ? `${Colors.accentRose}1F` : 'transparent',
                }}
              >
                <Text className="text-text1" style={{ fontSize: 13 }}>
                  {opt}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingVertical: 16, paddingBottom: 100 }}
      >
        {filtered.length === 0 ? (
          <View className="items-center" style={{ marginTop: 60, gap: 16 }}>
            <SakuraIcon size={60} color={Colors.text2} animating={false} />
            <Text className="text-text2" style={{ fontSize: 20 }}>
              No cards found
            </Text>
            <Text className="text-text3" style={{ fontSize: 12 }}>
              Try adjusting your search or filters
            </Text>
          </View>
        ) : displayMode === 'grid' ? (
          <View
            className="px-4"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}
          >
            {filtered.map((c) => (
              <GridCard key={c.id} contact={c} onPress={() => { onSelect(c); }} />
            ))}
          </View>
        ) : (
          <View className="px-4">
            {filtered.map((c) => (
              <ListRow key={c.id} contact={c} onPress={() => { onSelect(c); }} />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={() => { router.push('/shoutouts/new'); }}
        accessibilityRole="button"
        accessibilityLabel="Compose Sakura"
        style={{
          position: 'absolute',
          right: 24,
          bottom: 24 + insets.bottom,
          width: 50,
          height: 50,
          borderRadius: 25,
          backgroundColor: Colors.accentRose,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.accentRose,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 6,
        }}
      >
        <SakuraIcon size={20} color={Colors.cardBg} animating={isSakuraAnimating} />
      </Pressable>

      <ShoutoutFiltersSheet
        visible={showFiltersSheet}
        value={sheetFilters}
        availableTags={[]}
        onChange={(next) => {
          setSheetFilters(next);
          if (next.searchQuery !== searchQuery) {
            setSearchQuery(next.searchQuery);
          }
        }}
        onClose={() => { setShowFiltersSheet(false); }}
      />
    </View>
  );
}
