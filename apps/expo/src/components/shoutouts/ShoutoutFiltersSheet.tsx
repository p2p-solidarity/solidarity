/**
 * ShoutoutFiltersSheet — port of
 * solidarity/Views/ShoutoutViews/ShoutoutFiltersView.swift.
 *
 * Bottom-sheet style modal exposing the same sections as the Swift
 * filters form:
 *   • Search       — mirrors the gallery search input (kept in parent state).
 *   • Event Activity Level — High / Medium / Low / All.
 *   • Character Type — Professional / Creative / Technical / Social / All.
 *   • Tags         — multi-select chips from the supplied tag pool.
 *   • Clear All Filters — destructive footer button.
 *
 * The Swift screen reads/writes ShoutoutChartService.shared; until that
 * service is ported we plumb the state through props so the parent owns
 * the truth and any pending wiring stays in one place.
 */
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { useShoutoutChart } from '@/shoutouts/chartService';

export type ShoutoutEventType = 'High Activity' | 'Medium Activity' | 'Low Activity';

export type ShoutoutCharacterType =
  | 'Professional'
  | 'Creative'
  | 'Technical'
  | 'Social';

export const SHOUTOUT_EVENT_TYPES: readonly ShoutoutEventType[] = [
  'High Activity',
  'Medium Activity',
  'Low Activity',
];

export const SHOUTOUT_CHARACTER_TYPES: readonly ShoutoutCharacterType[] = [
  'Professional',
  'Creative',
  'Technical',
  'Social',
];

export interface ShoutoutFiltersState {
  readonly searchQuery: string;
  readonly selectedEventType: ShoutoutEventType | null;
  readonly selectedCharacterType: ShoutoutCharacterType | null;
  readonly selectedTags: readonly string[];
}

export const EMPTY_SHOUTOUT_FILTERS: ShoutoutFiltersState = {
  searchQuery: '',
  selectedEventType: null,
  selectedCharacterType: null,
  selectedTags: [],
};

export interface ShoutoutFiltersSheetProps {
  readonly visible: boolean;
  readonly value: ShoutoutFiltersState;
  readonly availableTags: readonly string[];
  readonly onChange: (next: ShoutoutFiltersState) => void;
  readonly onClose: () => void;
}

export function ShoutoutFiltersSheet({
  visible,
  value,
  availableTags,
  onChange,
  onClose,
}: ShoutoutFiltersSheetProps): ReactNode {
  const insets = useSafeAreaInsets();
  const chart = useShoutoutChart();
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const bucket of chart.byTag) map.set(bucket.label, bucket.count);
    return map;
  }, [chart.byTag]);

  const setSearch = (q: string) => { onChange({ ...value, searchQuery: q }); };
  const setEventType = (t: ShoutoutEventType | null) => {
    haptic('selection');
    onChange({ ...value, selectedEventType: t });
  };
  const setCharacterType = (t: ShoutoutCharacterType | null) => {
    haptic('selection');
    onChange({ ...value, selectedCharacterType: t });
  };
  const toggleTag = (tag: string) => {
    haptic('selection');
    const has = value.selectedTags.includes(tag);
    const next = has
      ? value.selectedTags.filter((t) => t !== tag)
      : [...value.selectedTags, tag];
    onChange({ ...value, selectedTags: next });
  };
  const clearAll = () => {
    haptic('warning');
    onChange(EMPTY_SHOUTOUT_FILTERS);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <View
          className="flex-row items-center"
          style={{ paddingHorizontal: 16, paddingVertical: 12 }}
        >
          <View style={{ width: 60 }} />
          <Text
            className="text-text1 text-center"
            style={{ flex: 1, fontSize: 17, fontWeight: '600' }}
          >
            Filters
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={{ width: 60, alignItems: 'flex-end' }}
          >
            <Text className="text-primaryBlue" style={{ fontSize: 15, fontWeight: '600' }}>
              Done
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 24 + insets.bottom,
            gap: 24,
          }}
        >
          <Section title="Search">
            <View
              className="bg-searchBg flex-row items-center"
              style={{
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: Colors.divider,
              }}
            >
              <SfIcon name="magnifyingglass" size={14} color={Colors.text2} />
              <TextInput
                value={value.searchQuery}
                onChangeText={setSearch}
                placeholder="Search users..."
                placeholderTextColor={Colors.text3}
                style={{
                  flex: 1,
                  marginLeft: 8,
                  color: Colors.text1,
                  fontSize: 15,
                }}
              />
              {value.searchQuery.length > 0 ? (
                <Pressable
                  onPress={() => { setSearch(''); }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <SfIcon name="xmark.circle.fill" size={14} color={Colors.text3} />
                </Pressable>
              ) : null}
            </View>
          </Section>

          <Section title="Event Activity Level">
            <OptionRow
              label="All Activity Levels"
              icon
              active={value.selectedEventType === null}
              onPress={() => { setEventType(null); }}
            />
            {SHOUTOUT_EVENT_TYPES.map((t) => (
              <OptionRow
                key={t}
                label={t}
                active={value.selectedEventType === t}
                onPress={() => { setEventType(t); }}
              />
            ))}
          </Section>

          <Section title="Character Type">
            <OptionRow
              label="All Character Types"
              icon
              active={value.selectedCharacterType === null}
              onPress={() => { setCharacterType(null); }}
            />
            {SHOUTOUT_CHARACTER_TYPES.map((t) => (
              <OptionRow
                key={t}
                label={t}
                active={value.selectedCharacterType === t}
                onPress={() => { setCharacterType(t); }}
              />
            ))}
          </Section>

          <Section title="Tags">
            {availableTags.length === 0 ? (
              <Text className="text-text2" style={{ fontSize: 13 }}>
                No tags available
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {availableTags.map((tag) => (
                  <TagFilterChip
                    key={tag}
                    tag={tag}
                    count={tagCounts.get(tag) ?? 0}
                    isSelected={value.selectedTags.includes(tag)}
                    onToggle={() => { toggleTag(tag); }}
                  />
                ))}
              </View>
            )}
          </Section>

          <ThemedButton
            variant="destructive"
            fullWidth
            label="Clear All Filters"
            onPress={clearAll}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <View style={{ gap: 12 }}>
      <Text
        className="text-text2"
        style={{
          fontSize: 13,
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {title}
      </Text>
      <View
        className="bg-cardBg"
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: Colors.divider,
          padding: 12,
          gap: 8,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function OptionRow({
  label,
  active,
  icon,
  onPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly icon?: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center active:opacity-80"
      style={{ paddingVertical: 8 }}
    >
      <View style={{ width: 20, alignItems: 'center' }}>
        {icon ? (
          <SfIcon name="xmark.circle" size={14} color={Colors.text2} />
        ) : (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: `${Colors.text2}66`,
            }}
          />
        )}
      </View>
      <Text className="text-text1" style={{ flex: 1, marginLeft: 12, fontSize: 15 }}>
        {label}
      </Text>
      {active ? (
        <SfIcon name="checkmark" size={14} weight="semibold" color={Colors.primaryBlue} />
      ) : null}
    </Pressable>
  );
}

function TagFilterChip({
  tag,
  count,
  isSelected,
  onToggle,
}: {
  readonly tag: string;
  readonly count: number;
  readonly isSelected: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`#${tag} (${String(count)})`}
      accessibilityState={{ selected: isSelected }}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: Colors.primaryBlue,
        backgroundColor: isSelected ? Colors.primaryBlue : `${Colors.primaryBlue}1A`,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '500',
          color: isSelected ? Colors.cardBg : Colors.primaryBlue,
        }}
      >
        {count > 0 ? `#${tag} (${String(count)})` : `#${tag}`}
      </Text>
    </Pressable>
  );
}
