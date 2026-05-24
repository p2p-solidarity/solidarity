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
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeGestureAutoBackup } from '@/backup';
import { SfIcon } from '@/components/icons/SfIcon';
import { PaperStackIllustration } from '@/components/decor/PaperStackIllustration';
import { ManualContactEntrySheet } from '@/components/people/ManualContactEntrySheet';
import { PeopleSearchField } from '@/components/people/PeopleSearchField';
import { TrustGraphContactRow } from '@/components/people/TrustGraphContactRow';
import { Colors } from '@/constants/Colors';
import { importFromDevice } from '@/contacts/importer';
import { useContactStore } from '@/contacts/repository';
import { pushToast } from '@/feedback/toast';
import { usePeopleScreen } from '@/people/usePeopleScreen';
import { usePreferences } from '@/settings/preferences';
import type { Contact } from '@solidarity/shared';

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
  const [importing, setImporting] = useState(false);

  // Swift PeopleListView → ContactPickerView → ContactImportService.shared
  // .importPickedContacts (iOS) / .importAllContacts (Android). We don't
  // have a CNContactPickerViewController on Android, so we mirror Android-
  // side behaviour: prompt + iterate all granted contacts via expo-contacts
  // and surface a single toast.
  const onImportFromPhone = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const { granted, count } = await importFromDevice();
      if (!granted) {
        pushToast('Contacts permission denied', 'warning');
        return;
      }
      refresh();
      pushToast(`Imported ${String(count)} contacts`, 'success', 3000);
    } catch {
      pushToast('Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const filtered = useMemo(
    () => filterContacts(contacts, searchQuery),
    [contacts, searchQuery],
  );

  const onSelectContact = (c: Contact) => {
    router.push({
      pathname: '/people/[id]',
      params: { id: c.id, name: c.businessCard.name },
    });
  };

  const onLongPressContact = (c: Contact) => {
    Alert.alert(
      `Delete ${c.businessCard.name}?`,
      'This contact will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removeContact(c.id);
              refresh();
            })();
          },
        },
      ],
    );
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
        onAddManually={() => { setManualSheetOpen(true); }}
        onImportPhone={() => { void onImportFromPhone(); }}
        onImportVcf={() => router.push('/contacts/import-vcf')}
        onRadarExchange={() => router.push('/(tabs)/share')}
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
          onImportPhone={() => { void onImportFromPhone(); }}
          onAddManually={() => { setManualSheetOpen(true); }}
          importing={importing}
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
            <FlatList
              data={filtered as Contact[]}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 90 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TrustGraphContactRow
                  contact={item}
                  onPress={() => onSelectContact(item)}
                  onLongPress={() => onLongPressContact(item)}
                />
              )}
            />
          )}
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

function Header({
  onAddManually,
  onImportPhone,
  onImportVcf,
  onRadarExchange,
  developerMode,
  menuOpen,
  setMenuOpen,
}: {
  onAddManually: () => void;
  onImportPhone: () => void;
  onImportVcf: () => void;
  onRadarExchange: () => void;
  developerMode: boolean;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
}) {
  return (
    <View className="px-4" style={{ height: 56 }}>
      <View className="flex-1 flex-row items-center justify-between">
        <Text className="text-text1 text-[18px] font-semibold">People List</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setMenuOpen(!menuOpen)}
          style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
          className="active:opacity-60"
        >
          <SfIcon name="plus" size={18} color={Colors.text1} />
        </Pressable>
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
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
      style={{
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: Colors.divider,
        minWidth: 200,
      }}
    >
      <SfIcon name={icon} size={16} color={Colors.text1} />
      <Text className="text-text1 text-[15px]">{label}</Text>
    </Pressable>
  );
}

function EmptyState({
  onImportPhone,
  onAddManually,
  importing,
}: {
  onImportPhone: () => void;
  onAddManually: () => void;
  importing: boolean;
}) {
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
          disabled={importing}
          className="rounded-sm2 active:opacity-80"
          style={{
            width: 200,
            height: 44,
            backgroundColor: Colors.invertedButtonBg,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: importing ? 0.6 : 1,
          }}
        >
          <Text
            style={{ color: Colors.invertedButtonText }}
            className="text-[15px]"
          >
            {importing ? 'Importing...' : 'Import from Phone'}
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
  contacts: readonly Contact[],
  query: string,
): readonly Contact[] {
  const trimmed = query.trim();
  const sorted = [...contacts].sort(
    (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
  );
  if (trimmed.length === 0) return sorted;
  const q = trimmed.toLowerCase();
  return sorted.filter((c) => {
    const name = c.businessCard.name.toLowerCase();
    const company = (c.businessCard.company ?? '').toLowerCase();
    const title = (c.businessCard.title ?? '').toLowerCase();
    return name.includes(q) || company.includes(q) || title.includes(q);
  });
}
