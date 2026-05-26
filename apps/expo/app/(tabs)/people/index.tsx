/**
 * People tab — 1:1 port of solidarity/Views/PeopleViews/PeopleListView.swift.
 *
 *   • Title "People List" (semibold 18pt, left-aligned) + trailing "+" menu
 *     (Radar Exchange [dev-mode] / Add Manually / Import from Phone /
 *     Import VCF File)
 *   • Search field (magnifyingglass + "Search" placeholder, 0.5pt
 *     textPrimary border) once contact list is non-empty
 *   • Empty state: PaperStackIllustration 214×214 +
 *     "Your contact list is empty" + 2 buttons (Import from Phone / Add
 *     Manually), no card border
 *   • Empty-search state: magnifyingglass + "No results for \"<query>\""
 *   • TrustGraphContactRow per contact, tap → /people/[id], long-press →
 *     Delete dialog: "Delete <name>?" / "This contact will be permanently
 *     removed."
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeGestureAutoBackup } from '@/backup';
import { SfIcon } from '@/components/icons/SfIcon';
import { PaperStackIllustration } from '@/components/decor/PaperStackIllustration';
import { ManualContactEntrySheet } from '@/components/people/ManualContactEntrySheet';
import { PeopleSearchField } from '@/components/people/PeopleSearchField';
import { TrustGraphContactRow } from '@/components/people/TrustGraphContactRow';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useContactStore, type ContactManifestEntry } from '@/contacts/repository';
import { confirmDialog } from '@/feedback/confirmDialog';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { usePeopleScreen } from '@/people/usePeopleScreen';
import { usePreferences } from '@/settings/preferences';

export default function PeopleTab() {
  const { contacts, refresh } = usePeopleScreen();
  const removeContact = useContactStore((s) => s.remove);
  const provider = usePreferences((s) => s.backupProvider);
  const autoEnabled = usePreferences((s) => s.autoBackupOnPull);
  const developerMode = usePreferences((s) => s.developerMode);
  const insets = useSafeAreaInsets();

  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [manualSheetOpen, setManualSheetOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const filtered = useMemo(
    () => filterContacts(contacts, searchQuery),
    [contacts, searchQuery],
  );

  const exitEditMode = () => {
    setEditMode(false);
    setSelectedIds(new Set());
  };

  const onSelectContact = (c: ContactManifestEntry) => {
    if (editMode) {
      toggleSelected(c.id);
      return;
    }
    router.push({
      pathname: '/people/[id]',
      params: { id: c.id, name: c.name },
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onLongPressContact = (c: ContactManifestEntry) => {
    haptic('tap');
    if (!editMode) {
      setEditMode(true);
      setSelectedIds(new Set([c.id]));
      return;
    }
    toggleSelected(c.id);
  };

  const onDeleteContact = (c: ContactManifestEntry) => {
    void (async () => {
      const ok = await confirmDialog({
        title: `Delete ${c.name}?`,
        message: 'This contact will be permanently removed.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      await removeContact(c.id);
      refresh();
    })();
  };

  const onBatchDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    void (async () => {
      const ok = await confirmDialog({
        title: ids.length === 1 ? 'Delete contact?' : `Delete ${String(ids.length)} contacts?`,
        message: 'These contacts will be permanently removed.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      for (const id of ids) {
        await removeContact(id);
      }
      pushToast(
        ids.length === 1 ? 'Contact deleted' : `Deleted ${String(ids.length)} contacts`,
        'success',
        2000,
      );
      exitEditMode();
      refresh();
    })();
  };

  const backupGesture = useMemo(
    () =>
      makeGestureAutoBackup(provider, {
        onComplete: () => { pushToast('Backed up to cloud', 'success', 2000); },
        onError: () => { pushToast('Backup failed', 'error'); },
      }),
    [provider],
  );

  const body = (
    <View className="flex-1">
      <Header
        editMode={editMode}
        selectedCount={selectedIds.size}
        totalVisible={filtered.length}
        allSelected={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
        onAddManually={() => { setManualSheetOpen(true); }}
        onImportPhone={() => router.push('/contacts/import-phone')}
        onImportVcf={() => router.push('/contacts/import-vcf')}
        onRadarExchange={() => router.push('/(tabs)/share')}
        onEnterEditMode={() => { setEditMode(true); }}
        onExitEditMode={exitEditMode}
        onToggleSelectAll={() => {
          setSelectedIds((prev) => {
            const allSelected = filtered.length > 0 && filtered.every((c) => prev.has(c.id));
            if (allSelected) return new Set();
            return new Set(filtered.map((c) => c.id));
          });
        }}
        developerMode={developerMode}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
      />

      <ManualContactEntrySheet
        visible={manualSheetOpen}
        onClose={() => { setManualSheetOpen(false); }}
        onSaved={() => { refresh(); }}
      />

      {contacts.length === 0 ? (
        <EmptyState
          onImportPhone={() => router.push('/contacts/import-phone')}
          onAddManually={() => { setManualSheetOpen(true); }}
        />
      ) : (
        <>
          {/* Search bar stays mounted whenever there is data so the input
              doesn't flicker in/out as users type past their last match. */}
          <View className="px-4 pb-3">
            <PeopleSearchField value={searchQuery} onChangeText={setSearchQuery} />
          </View>
          {filtered.length === 0 ? (
            <EmptySearchState query={searchQuery} />
          ) : (
            <FlashList
              data={filtered as ContactManifestEntry[]}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: editMode ? 100 : 90 }}
              keyboardShouldPersistTaps="handled"
              extraData={{ editMode, selectedIds }}
              renderItem={({ item }) => (
                <PeopleRow
                  contact={item}
                  editMode={editMode}
                  selected={selectedIds.has(item.id)}
                  onPress={() => onSelectContact(item)}
                  onLongPress={() => onLongPressContact(item)}
                  onSwipeDelete={() => onDeleteContact(item)}
                />
              )}
            />
          )}
          {editMode ? (
            <BatchActionBar
              count={selectedIds.size}
              onCancel={exitEditMode}
              onDelete={onBatchDelete}
            />
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      {autoEnabled ? (
        <GestureDetector gesture={backupGesture}>{body}</GestureDetector>
      ) : (
        body
      )}
    </View>
  );
}

/**
 * PeopleRow — wraps the existing TrustGraphContactRow with:
 *   - a leading selection circle when edit mode is active
 *   - ReanimatedSwipeable revealing a destructive "Delete" action on swipe
 *
 * Swipe is disabled while edit mode is active so the gesture doesn't fight
 * the multi-select tap target. Long-press still enters edit mode.
 */
function PeopleRow({
  contact,
  editMode,
  selected,
  onPress,
  onLongPress,
  onSwipeDelete,
}: {
  readonly contact: ContactManifestEntry;
  readonly editMode: boolean;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
  readonly onSwipeDelete: () => void;
}) {
  const inner = (
    <View className="flex-row items-center bg-pageBg">
      {editMode ? (
        <View style={{ paddingLeft: 4, paddingRight: 8 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: selected ? Colors.destructive : Colors.text3,
              backgroundColor: selected ? Colors.destructive : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected ? (
              <SfIcon name="checkmark" size={12} color={Colors.invertedButtonText} />
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <TrustGraphContactRow
          contact={contact}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      </View>
    </View>
  );

  if (editMode) return inner;

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={48}
      overshootRight={false}
      renderRightActions={() => (
        <SwipeDeleteAction onPress={onSwipeDelete} />
      )}
      onSwipeableOpen={(direction) => {
        if (direction === 'right') haptic('warning');
      }}
    >
      {inner}
    </ReanimatedSwipeable>
  );
}

function SwipeDeleteAction({ onPress }: { readonly onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Delete contact"
      style={{
        width: 88,
        backgroundColor: Colors.destructive,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SfIcon name="trash" size={18} color={Colors.invertedButtonText} />
      <Text
        style={{
          color: Colors.invertedButtonText,
          fontSize: 12,
          marginTop: 4,
          fontWeight: '500',
        }}
      >
        Delete
      </Text>
    </Pressable>
  );
}

function BatchActionBar({
  count,
  onCancel,
  onDelete,
}: {
  readonly count: number;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 16,
        flexDirection: 'row',
        gap: 12,
        padding: 12,
        backgroundColor: Colors.cardBg,
        borderRadius: 12,
        borderWidth: 0.5,
        borderColor: Colors.divider,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
      }}
    >
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel selection"
        style={{
          flex: 1,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="active:opacity-70"
      >
        <Text className="text-text1 text-[15px]">Cancel</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={count === 0}
        accessibilityRole="button"
        accessibilityLabel="Delete selected contacts"
        style={{
          flex: 1,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: count === 0 ? `${Colors.destructive}55` : Colors.destructive,
          borderRadius: 8,
        }}
        className="active:opacity-80"
      >
        <Text
          style={{
            color: Colors.invertedButtonText,
            fontSize: 15,
            fontWeight: '500',
          }}
        >
          {count === 0 ? 'Delete' : `Delete ${String(count)}`}
        </Text>
      </Pressable>
    </View>
  );
}

function Header({
  editMode,
  selectedCount,
  totalVisible,
  allSelected,
  onAddManually,
  onImportPhone,
  onImportVcf,
  onRadarExchange,
  onEnterEditMode,
  onExitEditMode,
  onToggleSelectAll,
  developerMode,
  menuOpen,
  setMenuOpen,
}: {
  editMode: boolean;
  selectedCount: number;
  totalVisible: number;
  allSelected: boolean;
  onAddManually: () => void;
  onImportPhone: () => void;
  onImportVcf: () => void;
  onRadarExchange: () => void;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  onToggleSelectAll: () => void;
  developerMode: boolean;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
}) {
  const c = useThemeColors();

  if (editMode) {
    return (
      <View className="px-4" style={{ height: 56 }}>
        <View className="flex-1 flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            onPress={onToggleSelectAll}
            disabled={totalVisible === 0}
            hitSlop={8}
            className="active:opacity-60"
          >
            <Text
              className="text-text1 text-[15px]"
              style={{ opacity: totalVisible === 0 ? 0.4 : 1 }}
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </Text>
          </Pressable>
          <Text className="text-text1 text-[15px] font-semibold">
            {selectedCount > 0
              ? selectedCount === 1
                ? '1 Selected'
                : `${String(selectedCount)} Selected`
              : 'Select Contacts'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onExitEditMode}
            hitSlop={8}
            className="active:opacity-60"
          >
            <Text className="text-text1 text-[15px] font-medium">Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="px-4" style={{ height: 56 }}>
      <View className="flex-1 flex-row items-center justify-between">
        <Text className="text-text1 text-[18px] font-semibold">People List</Text>
        <View className="flex-row items-center" style={{ columnGap: 16 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit contacts"
            onPress={onEnterEditMode}
            disabled={totalVisible === 0}
            hitSlop={8}
            style={{ opacity: totalVisible === 0 ? 0.4 : 1 }}
            className="active:opacity-60"
          >
            <Text className="text-text1 text-[14px]">Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMenuOpen(!menuOpen)}
            style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
            className="active:opacity-60"
          >
            <SfIcon name="plus" size={18} color={c.text1} />
          </Pressable>
        </View>
      </View>
      {menuOpen ? (
        <View
          className="absolute right-4 top-12 rounded-lg bg-cardBg"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 12,
            elevation: 6,
            zIndex: 10,
          }}
        >
          {developerMode ? (
            <MenuItem
              icon="antenna.radiowaves.left.and.right"
              label="Radar Exchange"
              onPress={() => { setMenuOpen(false); onRadarExchange(); }}
            />
          ) : null}
          <MenuItem
            icon="square.and.pencil"
            label="Add Manually"
            onPress={() => { setMenuOpen(false); onAddManually(); }}
          />
          <MenuItem
            icon="person.crop.circle.badge.plus"
            label="Import from Phone"
            onPress={() => { setMenuOpen(false); onImportPhone(); }}
          />
          <MenuItem
            icon="doc.badge.plus"
            label="Import VCF File"
            onPress={() => { setMenuOpen(false); onImportVcf(); }}
            isLast
          />
        </View>
      ) : null}
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  isLast = false,
}: {
  icon: import('expo-symbols').SFSymbol;
  label: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
      style={{
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: c.divider,
        minWidth: 200,
      }}
    >
      <SfIcon name={icon} size={16} color={c.text1} />
      <Text className="text-text1 text-[15px]">{label}</Text>
    </Pressable>
  );
}

function EmptyState({
  onImportPhone,
  onAddManually,
}: {
  onImportPhone: () => void;
  onAddManually: () => void;
}) {
  const c = useThemeColors();
  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{ width: 214, height: 214, alignItems: 'center', justifyContent: 'center' }}
      >
        <PaperStackIllustration size={214} />
      </View>
      <Text className="text-text2 text-[14px] text-center pb-8">
        Your contact list is empty
      </Text>
      <View className="gap-2 py-4 items-center">
        <Pressable
          onPress={onImportPhone}
          accessibilityRole="button"
          className="rounded-sm2 active:opacity-80"
          style={{
            width: 200,
            height: 44,
            backgroundColor: c.invertedButtonBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: c.invertedButtonText }} className="text-[15px]">
            Import from Phone
          </Text>
        </Pressable>
        <Pressable
          onPress={onAddManually}
          accessibilityRole="button"
          style={{
            width: 200,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          <Text className="text-text1 text-[15px]">Add Manually</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function EmptySearchState({ query }: { query: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <SfIcon name="magnifyingglass" size={36} color={Colors.text3} />
      <Text className="text-text2 text-[14px]">{`No results for "${query}"`}</Text>
    </View>
  );
}

function filterContacts(
  contacts: readonly ContactManifestEntry[],
  query: string,
): readonly ContactManifestEntry[] {
  const trimmed = query.trim();
  // Manifest `receivedAt` is an ISO string; lexicographic compare matches
  // chronological order so we skip an unnecessary `new Date()` per row.
  const sorted = [...contacts].sort((a, b) =>
    a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0,
  );
  if (trimmed.length === 0) return sorted;
  const q = trimmed.toLowerCase();
  return sorted.filter((c) => {
    const name = c.name.toLowerCase();
    const company = (c.company ?? '').toLowerCase();
    const title = (c.title ?? '').toLowerCase();
    return name.includes(q) || company.includes(q) || title.includes(q);
  });
}
