/**
 * Import-from-phone multi-select picker.
 *
 * Replaces the old `picker.tsx` shim that fired `importFromDevice()` on mount
 * and dumped every address-book contact into the local repository with no
 * user input. Privacy + signal-to-noise both demanded the same fix: surface a
 * list, let the user pick which contacts to bring across, then only upsert
 * the picked rows.
 *
 * Flow:
 *   1. Mount → permission prompt + `loadDeviceContacts()`.
 *   2. Render the rows in a `FlashList` with a search box and a "Select all"
 *      toggle. Tapping a row toggles its selection state.
 *   3. Footer shows "Import N" + "Cancel"; tap import → `importDeviceContacts`
 *      → router.back() with a toast.
 *
 * Permission denial and zero-contacts both show informative empty states so
 * the user knows what to do next (open Settings, or add a contact manually).
 */
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import { SfIcon } from '@/components/icons/SfIcon';
import { LimitedAccessBanner } from '@/components/people/LimitedAccessBanner';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  importDeviceContacts,
  loadDeviceContacts,
  presentContactAccessPicker,
  type DeviceContactPickerRow,
} from '@/contacts/importer';
import { pushToast } from '@/feedback/toast';

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'denied' }
  | {
      readonly kind: 'ready';
      readonly access: 'all' | 'limited';
      readonly rows: readonly DeviceContactPickerRow[];
    }
  | { readonly kind: 'error'; readonly message: string };

export default function ImportFromPhoneScreen(): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [importing, setImporting] = useState(false);
  const [selectingMore, setSelectingMore] = useState(false);

  // Non-rendered guard so the shared load path can run both on mount and after
  // the limited-access picker without setting state on an unmounted screen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyLoad = useCallback(async (): Promise<void> => {
    try {
      const { access, rows } = await loadDeviceContacts();
      if (!mountedRef.current) return;
      if (access === 'none') {
        setPhase({ kind: 'denied' });
        return;
      }
      setPhase({ kind: 'ready', access, rows });
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase({ kind: 'error', message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void applyLoad();
  }, [applyLoad]);

  const onSelectMore = useCallback((): void => {
    if (selectingMore) return;
    setSelectingMore(true);
    void (async () => {
      try {
        // iOS 18+ limited access: the system sheet shows the FULL address book
        // so the user grants more contacts, then we re-read the expanded set.
        await presentContactAccessPicker();
        await applyLoad();
      } catch {
        // Sheet dismissed / unsupported — leave the current list untouched.
      } finally {
        if (mountedRef.current) setSelectingMore(false);
      }
    })();
  }, [selectingMore, applyLoad]);

  const onOpenSettings = useCallback((): void => {
    void Linking.openSettings();
  }, []);

  const allRows = phase.kind === 'ready' ? phase.rows : [];
  const filtered = useMemo(() => filterRows(allRows, query), [allRows, query]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.key));

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filtered) next.delete(r.key);
      } else {
        for (const r of filtered) next.add(r.key);
      }
      return next;
    });
  };

  const onImport = (): void => {
    if (importing || phase.kind !== 'ready') return;
    const picked = phase.rows.filter((r) => selected.has(r.key));
    if (picked.length === 0) return;
    setImporting(true);
    void (async () => {
      try {
        const count = await importDeviceContacts(picked);
        pushToast(
          count === 1
            ? t('contactImport.importedOne')
            : t('contactImport.importedMany', { count }),
          'success',
          3000,
        );
        router.back();
      } catch {
        pushToast(t('contactImport.importFailed'), 'error');
      } finally {
        setImporting(false);
      }
    })();
  };

  const onCancel = (): void => {
    router.back();
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <View
        className="flex-1 bg-pageBg"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <TopBar onCancel={onCancel} selectedCount={selected.size} />

        {phase.kind === 'ready' ? (
          <>
            {phase.access === 'limited' ? (
              <LimitedAccessBanner
                count={phase.rows.length}
                working={selectingMore}
                onSelectMore={onSelectMore}
                onOpenSettings={onOpenSettings}
              />
            ) : null}
            <SearchBar value={query} onChange={setQuery} />
            <SelectAllRow
              count={filtered.length}
              allSelected={allFilteredSelected}
              onToggle={toggleAll}
            />
            <FlashList
              data={filtered}
              keyExtractor={(r) => r.key}
              renderItem={({ item }) => (
                <PickerRow
                  row={item}
                  selected={selected.has(item.key)}
                  onToggle={() => { toggle(item.key); }}
                />
              )}
              ListEmptyComponent={
                <EmptyMessage
                  text={
                    query.trim().length > 0
                      ? t('contactImport.noResults', { query })
                      : t('contactImport.noContacts')
                  }
                />
              }
              contentContainerStyle={{ paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            />
          </>
        ) : null}

        {phase.kind === 'loading' ? (
          <CenterMessage>
            <ActivityIndicator />
            <Text className="text-text2 text-[14px]" style={{ marginTop: 12 }}>
              {t('contactImport.loading')}
            </Text>
          </CenterMessage>
        ) : null}

        {phase.kind === 'denied' ? (
          <DeniedState onCancel={onCancel} onOpenSettings={onOpenSettings} />
        ) : null}

        {phase.kind === 'error' ? (
          <CenterMessage>
            <Text className="text-text1 text-[15px]" style={{ textAlign: 'center' }}>
              {t('contactImport.readError')}
            </Text>
            <Text className="text-text2 text-[13px]" style={{ marginTop: 6, textAlign: 'center' }}>
              {phase.message}
            </Text>
          </CenterMessage>
        ) : null}

        {phase.kind === 'ready' ? (
          <Footer
            count={selected.size}
            importing={importing}
            onCancel={onCancel}
            onImport={onImport}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function TopBar({
  onCancel,
  selectedCount,
}: {
  readonly onCancel: () => void;
  readonly selectedCount: number;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, height: 56 }}
    >
      <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
        <Text className="text-text1 text-[16px]">{t('contactImport.cancel')}</Text>
      </Pressable>
      <Text className="text-text1 text-[17px] font-semibold">{t('contactImport.title')}</Text>
      <Text
        className="text-text2 text-[14px]"
        style={{ minWidth: 56, textAlign: 'right' }}
      >
        {selectedCount > 0 ? String(selectedCount) : ''}
      </Text>
    </View>
  );
}

function SearchBar({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <View
        className="bg-searchBg rounded-sm2 flex-row items-center"
        style={{
          height: 40,
          paddingHorizontal: 12,
          borderWidth: 0.5,
          borderColor: Colors.divider,
        }}
      >
        <SfIcon name="magnifyingglass" size={14} color={Colors.text3} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={t('contactImport.search')}
          placeholderTextColor={Colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          className="text-text1 flex-1"
          style={{ fontSize: 15, padding: 0, marginLeft: 8 }}
        />
      </View>
    </View>
  );
}

function SelectAllRow({
  count,
  allSelected,
  onToggle,
}: {
  readonly count: number;
  readonly allSelected: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={allSelected ? t('contactImport.deselectAll') : t('contactImport.selectAll')}
      className="flex-row items-center justify-between active:opacity-70"
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: Colors.divider,
      }}
    >
      <Text className="text-text1 text-[14px] font-medium">
        {allSelected ? t('contactImport.deselectAll') : t('contactImport.selectAll')}
      </Text>
      <Text className="text-text3 text-[12px]">{t('contactImport.contactsCount', { count })}</Text>
    </Pressable>
  );
}

function PickerRow({
  row,
  selected,
  onToggle,
}: {
  readonly row: DeviceContactPickerRow;
  readonly selected: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={row.name}
      className="flex-row items-center active:opacity-70"
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: Colors.divider,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: selected ? Colors.invertedButtonBg : Colors.text3,
          backgroundColor: selected ? Colors.invertedButtonBg : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        {selected ? (
          <SfIcon name="checkmark" size={12} color={Colors.invertedButtonText} />
        ) : null}
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-text1 text-[15px] font-medium">
          {row.name}
        </Text>
        {row.subtitle ? (
          <Text numberOfLines={1} className="text-text2 text-[13px]" style={{ marginTop: 2 }}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Footer({
  count,
  importing,
  onCancel,
  onImport,
}: {
  readonly count: number;
  readonly importing: boolean;
  readonly onCancel: () => void;
  readonly onImport: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center"
      style={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 12,
        borderTopWidth: 0.5,
        borderTopColor: Colors.divider,
      }}
    >
      <View style={{ flex: 1 }}>
        <ThemedButton label={t('contactImport.cancel')} variant="secondary" fullWidth onPress={onCancel} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedButton
          label={count === 0 ? t('contactImport.import') : t('contactImport.importCount', { count })}
          variant="inverted"
          fullWidth
          disabled={count === 0}
          loading={importing}
          onPress={onImport}
        />
      </View>
    </View>
  );
}

function DeniedState({
  onCancel,
  onOpenSettings,
}: {
  readonly onCancel: () => void;
  readonly onOpenSettings: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <CenterMessage>
      <Text className="text-text1 text-[16px] font-medium" style={{ textAlign: 'center' }}>
        {t('contactImport.deniedTitle')}
      </Text>
      <Text
        className="text-text2 text-[13px]"
        style={{ marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}
      >
        {t('contactImport.deniedBody')}
      </Text>
      <View style={{ marginTop: 20, flexDirection: 'row', gap: 12 }}>
        <ThemedButton
          label={t('common.openSettings')}
          variant="inverted"
          onPress={onOpenSettings}
        />
        <ThemedButton label={t('contactImport.close')} variant="secondary" onPress={onCancel} />
      </View>
    </CenterMessage>
  );
}

function EmptyMessage({ text }: { readonly text: string }): ReactNode {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <Text className="text-text2 text-[14px]">{text}</Text>
    </View>
  );
}

function CenterMessage({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: 24 }}>
      {children}
    </View>
  );
}

function filterRows(
  rows: readonly DeviceContactPickerRow[],
  query: string,
): readonly DeviceContactPickerRow[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return rows;
  return rows.filter((r) => {
    if (r.name.toLowerCase().includes(trimmed)) return true;
    if (r.email && r.email.toLowerCase().includes(trimmed)) return true;
    if (r.phone && r.phone.toLowerCase().includes(trimmed)) return true;
    if (r.subtitle && r.subtitle.toLowerCase().includes(trimmed)) return true;
    return false;
  });
}
