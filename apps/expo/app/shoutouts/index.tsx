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
 *
 * Every touchable presses through `PressableScale` (crisp scale + haptic);
 * callers that already fire their own haptic pass `haptic={false}`.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SakuraIcon } from '@/components/brand/SakuraIcon';
import { PressableScale } from '@/components/common/PressableScale';
import { DecorativeBlobs } from '@/components/decor/DecorativeBlobs';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SectionTabButton,
  StatsSection,
} from '@/components/shoutouts/charts';
import {
  EMPTY_SHOUTOUT_FILTERS,
  ShoutoutFiltersSheet,
  type ShoutoutFiltersState,
} from '@/components/shoutouts/ShoutoutFiltersSheet';
import { Colors } from '@/constants/Colors';
import { useContactListDetail } from '@/contacts/repository';
import { haptic } from '@/feedback/haptics';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import { useShoutoutChartData, useShoutoutStore } from '@/shoutouts/store';
import { GridCard, ListRow } from '@/shoutouts/ui';
import type { Contact } from '@solidarity/shared';

type DisplayMode = 'grid' | 'list';
type FilterOption = 'All Cards' | 'Verified Only' | 'Recently Added';
type SectionTab = 'feed' | 'stats';

const FILTER_OPTIONS: readonly FilterOption[] = [
  'All Cards',
  'Verified Only',
  'Recently Added',
];

const FILTER_OPTION_KEYS: Record<FilterOption, string> = {
  'All Cards': 'shoutouts.filter.allCards',
  'Verified Only': 'shoutouts.filter.verifiedOnly',
  'Recently Added': 'shoutouts.filter.recentlyAdded',
};

export default function ShoutoutsHub(): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const contacts = useContactListDetail();
  const [searchQuery, setSearchQuery] = useState('');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('grid');
  const [filterOption, setFilterOption] = useState<FilterOption>('All Cards');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showFiltersSheet, setShowFiltersSheet] = useState(false);
  const [sheetFilters, setSheetFilters] = useState<ShoutoutFiltersState>(
    EMPTY_SHOUTOUT_FILTERS
  );
  const [isSakuraAnimating, setIsSakuraAnimating] = useState(false);
  const [sectionTab, setSectionTab] = useState<SectionTab>('feed');
  const hydrateShoutouts = useShoutoutStore((s) => s.hydrate);
  const chart = useShoutoutChartData();

  useEffect(() => {
    setIsSakuraAnimating(true);
    void hydrateShoutouts();
  }, [hydrateShoutouts]);

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
            <PressableScale
              onPress={() => { setDisplayMode('grid'); }}
              haptic="selection"
              scaleTo={SCALE.icon}
              accessibilityRole="button"
              accessibilityState={{ selected: displayMode === 'grid' }}
              accessibilityLabel={t('shoutouts.gridView')}
              hitSlop={{ top: 7, bottom: 7 }}
              style={{
                padding: 8,
                backgroundColor:
                  displayMode === 'grid' ? `${Colors.accentRose}33` : 'transparent',
              }}
            >
              <SfIcon name="square.grid.2x2" size={14} color={Colors.text1} />
            </PressableScale>
            <PressableScale
              onPress={() => { setDisplayMode('list'); }}
              haptic="selection"
              scaleTo={SCALE.icon}
              accessibilityRole="button"
              accessibilityState={{ selected: displayMode === 'list' }}
              accessibilityLabel={t('shoutouts.listView')}
              hitSlop={{ top: 7, bottom: 7 }}
              style={{
                padding: 8,
                backgroundColor:
                  displayMode === 'list' ? `${Colors.accentRose}33` : 'transparent',
              }}
            >
              <SfIcon name="list.bullet" size={14} color={Colors.text1} />
            </PressableScale>
          </View>

          <PressableScale
            onPress={() => {
              haptic('tap');
              setSheetFilters((prev) => ({ ...prev, searchQuery }));
              setShowFiltersSheet(true);
            }}
            haptic={false}
            scaleTo={SCALE.icon}
            accessibilityRole="button"
            accessibilityLabel={t('shoutouts.openFilters')}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            containerStyle={{ marginLeft: 8 }}
            style={{ padding: 4 }}
          >
            <SfIcon
              name="line.3.horizontal.decrease.circle"
              size={20}
              color={Colors.text1}
            />
          </PressableScale>

          <PressableScale
            onPress={onRefresh}
            haptic={false}
            scaleTo={SCALE.icon}
            accessibilityRole="button"
            accessibilityLabel={t('shoutouts.refresh')}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            containerStyle={{ marginLeft: 8 }}
            style={{ padding: 4 }}
          >
            <SfIcon name="arrow.triangle.2.circlepath" size={20} color={Colors.text1} />
          </PressableScale>
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
            {t('shoutouts.cardCount', { count: filtered.length })}
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
            placeholder={t('shoutouts.searchPlaceholder')}
            placeholderTextColor={Colors.text3}
            style={{ flex: 1, marginLeft: 8, color: Colors.text1, fontSize: 15 }}
          />
          {searchQuery.length > 0 ? (
            <PressableScale
              onPress={() => { setSearchQuery(''); }}
              haptic={false}
              scaleTo={SCALE.icon}
              accessibilityRole="button"
              accessibilityLabel={t('shoutouts.clearSearch')}
              hitSlop={15}
            >
              <SfIcon name="xmark.circle.fill" size={14} color={Colors.text2} />
            </PressableScale>
          ) : null}
          <PressableScale
            onPress={() => { setShowFilterMenu((v) => !v); }}
            haptic="selection"
            accessibilityRole="button"
            accessibilityState={{ expanded: showFilterMenu }}
            accessibilityLabel={t('shoutouts.filterOptions')}
            hitSlop={{ top: 14, bottom: 14 }}
            containerStyle={{ marginLeft: 12 }}
          >
            <View className="flex-row items-center">
              <SfIcon
                name="line.3.horizontal.decrease.circle"
                size={12}
                color={Colors.text2}
              />
              <Text className="text-text2" style={{ fontSize: 12, marginLeft: 4 }}>
                {t(FILTER_OPTION_KEYS[filterOption])}
              </Text>
            </View>
          </PressableScale>
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
              <PressableScale
                key={opt}
                onPress={() => {
                  setFilterOption(opt);
                  setShowFilterMenu(false);
                }}
                haptic="selection"
                accessibilityRole="button"
                accessibilityState={{ selected: opt === filterOption }}
                accessibilityLabel={t(FILTER_OPTION_KEYS[opt])}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  minHeight: 44,
                  justifyContent: 'center',
                  backgroundColor:
                    opt === filterOption ? `${Colors.accentRose}1F` : 'transparent',
                }}
              >
                <Text className="text-text1" style={{ fontSize: 13 }}>
                  {t(FILTER_OPTION_KEYS[opt])}
                </Text>
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>

      <View
        className="flex-row px-4"
        style={{ marginTop: 12, gap: 8 }}
        accessibilityRole="tablist"
      >
        <SectionTabButton
          label={t('shoutouts.tabFeed')}
          active={sectionTab === 'feed'}
          onPress={() => { setSectionTab('feed'); }}
        />
        <SectionTabButton
          label={t('shoutouts.tabStats')}
          active={sectionTab === 'stats'}
          onPress={() => { setSectionTab('stats'); }}
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingVertical: 16, paddingBottom: 100 }}
      >
        {sectionTab === 'stats' ? (
          <StatsSection chart={chart} />
        ) : filtered.length === 0 ? (
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

      <PressableScale
        onPress={() => { router.push('/shoutouts/new'); }}
        scaleTo={SCALE.tile}
        accessibilityRole="button"
        accessibilityLabel="Compose Sakura"
        containerStyle={{ position: 'absolute', right: 24, bottom: 24 + insets.bottom }}
        hitSlop={3}
        style={{
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
      </PressableScale>

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
