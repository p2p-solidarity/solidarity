/**
 * PageAddSheet — the Page tab's one "＋ 新增" menu. Links, sections and
 * attestations used to each carry their own add button (新增連結 / ＋ 新增區塊 /
 * ＋ 新增證明); the tab now has a single entry point, and this sheet sorts the
 * choice under the same labels the page itself uses (連結 / 區塊 / 證明), so
 * whatever you pick lands in the group of the same name.
 *
 * Shape: the mock's `#sh-addfield` (`creds-design/verified-linkinbio-mock-v3.html`)
 * — `.proof-sec` group labels over a 3-column `.tpl-grid` of icon tiles, with
 * the `.pro-tag` on a section only a Pro plan can add.
 *
 * Every choice runs only after the sheet's exit (`close(after)`): the next
 * screen never slides in over a sheet that is still leaving, and a second tap
 * during the exit is dropped by `close` instead of adding a section twice.
 */
import type { SFSymbol } from 'expo-symbols';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import { MAX_PAGE_BLOCK_COUNT, PAGE_BLOCK_CATALOG, type PageBlockType } from '@/page/pageDesign';
import { usePageDesignStore } from '@/page/pageDesignStore';
import { useProGate } from '@/pro/useProGate';

import { PageSectionLabel } from './PageSectionLabel';
import { ICON_TILE_GLYPH, iconTileStyle } from './pageRowStyles';
import { SlideUpSheet, type SheetClose } from './SlideUpSheet';

type SectionType = Exclude<PageBlockType, 'links'>;

/** `.tpl-grid` — three equal columns, 8pt apart. */
const GRID_COLUMNS = 3;
const GRID_GAP = 8;

const SECTION_ICON: Readonly<Record<SectionType, SFSymbol>> = {
  text: 'doc.text',
  portfolio: 'photo',
  featured: 'sparkles',
  video: 'play.rectangle.fill',
  shop: 'tag',
  'leave-card': 'person.text.rectangle',
  booking: 'calendar.badge.checkmark',
};

interface AddTile {
  readonly key: string;
  readonly label: string;
  readonly icon: SFSymbol;
  /** Draw the PRO tag — only for a locked entry, never for a paying user. */
  readonly pro?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly onPress: () => void;
}

export interface PageAddSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onAddLink: () => void;
  readonly onImportLinks: () => void;
  readonly onAddProof: () => void;
}

export function PageAddSheet({
  visible,
  onClose,
  onAddLink,
  onImportLinks,
  onAddProof,
}: PageAddSheetProps): ReactNode {
  return (
    <SlideUpSheet visible={visible} onClose={onClose}>
      {(close) => (
        <PageAddSheetContent
          close={close}
          onAddLink={onAddLink}
          onImportLinks={onImportLinks}
          onAddProof={onAddProof}
        />
      )}
    </SlideUpSheet>
  );
}

function PageAddSheetContent({
  close,
  onAddLink,
  onImportLinks,
  onAddProof,
}: {
  readonly close: SheetClose;
  readonly onAddLink: () => void;
  readonly onImportLinks: () => void;
  readonly onAddProof: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const status = usePageDesignStore((state) => state.status);
  const blockCount = usePageDesignStore((state) => state.design.blocks.length);
  const addBlock = usePageDesignStore((state) => state.addBlock);
  const { locked } = useProGate();

  // Sections can only be added to a design that has loaded, and never past
  // the cap `addPageBlock` enforces — the tiles say so instead of silently
  // doing nothing.
  const sectionsFull = blockCount >= MAX_PAGE_BLOCK_COUNT;
  const sectionsUnavailable = status !== 'ready' || sectionsFull;
  const sectionsNote = status === 'loading'
    ? t('pageDesign.loading')
    : status === 'error'
      ? t('pageDesign.loadError')
      : sectionsFull
        ? t('pageAdd.sectionsFull', { count: MAX_PAGE_BLOCK_COUNT })
        : null;

  const linkTiles: readonly AddTile[] = [
    {
      key: 'link',
      label: t('meHome.addLink'),
      icon: 'link',
      onPress: () => { close(onAddLink); },
    },
    {
      key: 'import',
      label: t('mePage.importLinks'),
      icon: 'square.and.arrow.down',
      onPress: () => { close(onImportLinks); },
    },
  ];

  const sectionTiles: readonly AddTile[] = PAGE_BLOCK_CATALOG.flatMap((entry) => {
    if (entry.type === 'links') return [];
    const type: SectionType = entry.type;
    const label = t(`pageDesign.block.${type}`);
    const entryLocked = locked(entry.pro);
    return [{
      key: type,
      label,
      icon: SECTION_ICON[type],
      pro: entryLocked,
      disabled: sectionsUnavailable,
      ...(entryLocked ? { hint: t('pageDesign.proControl') } : {}),
      onPress: () => {
        if (entryLocked) {
          close(() => { router.push('/settings/pro'); });
          return;
        }
        close(() => { addBlock(type, label); });
      },
    }];
  });

  const proofTiles: readonly AddTile[] = [
    {
      key: 'proof',
      label: t('mePage.createProof'),
      icon: 'checkmark.shield',
      onPress: () => { close(onAddProof); },
    },
  ];

  return (
    <ThemedSurface
      variant="elevated"
      className="rounded-none px-4 pt-5"
      style={{ maxHeight: windowHeight - Math.max(insets.top, 12) }}>
      <View className="flex-row items-start gap-3">
        <ThemedText variant="titleLarge" className="flex-1 pt-2">
          {t('pageAdd.title')}
        </ThemedText>
        <PressableScale
          haptic="tap"
          scaleTo={SCALE.icon}
          onPress={() => { close(); }}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="xmark" size={16} color={Colors.text1} />
        </PressableScale>
      </View>

      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          gap: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}>
        <AddGroup title={t('mePage.links')} tiles={linkTiles} />
        <AddGroup title={t('mePage.sections')} note={sectionsNote} tiles={sectionTiles} />
        <AddGroup title={t('mePage.attestations')} tiles={proofTiles} />
      </ScrollView>
    </ThemedSurface>
  );
}

function AddGroup({
  title,
  note = null,
  tiles,
}: {
  readonly title: string;
  readonly note?: string | null;
  readonly tiles: readonly AddTile[];
}): ReactNode {
  const rows: (readonly AddTile[])[] = [];
  for (let start = 0; start < tiles.length; start += GRID_COLUMNS) {
    rows.push(tiles.slice(start, start + GRID_COLUMNS));
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <PageSectionLabel title={title} />
        </View>
        {note !== null ? (
          <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
            {note}
          </ThemedText>
        ) : null}
      </View>
      <View style={{ gap: GRID_GAP }}>
        {rows.map((row) => (
          // Rows stretch, so a label that wraps to two lines keeps every tile
          // beside it the same height; spacers hold a short last row to the
          // same column widths as the rows above it.
          <View key={row.map((tile) => tile.key).join('|')} style={{ flexDirection: 'row', gap: GRID_GAP }}>
            {row.map((tile) => <AddTileButton key={tile.key} tile={tile} />)}
            {Array.from({ length: GRID_COLUMNS - row.length }, (_, index) => (
              <View key={`spacer-${String(index)}`} style={{ flex: 1 }} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function AddTileButton({ tile }: { readonly tile: AddTile }): ReactNode {
  const c = useThemeColors();
  const disabled = tile.disabled === true;
  return (
    <PressableScale
      fill
      scaleTo={SCALE.tile}
      haptic={disabled ? false : 'tap'}
      disabled={disabled}
      onPress={tile.onPress}
      accessibilityRole="button"
      accessibilityLabel={tile.pro ? `${tile.label}, PRO` : tile.label}
      accessibilityHint={tile.hint}
      accessibilityState={{ disabled }}
      className="items-center border border-divider bg-cardBg px-1 pb-2.5 pt-3"
      style={{ flexGrow: 1, gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <View style={iconTileStyle(c.chipSurface)}>
        <SfIcon name={tile.icon} size={ICON_TILE_GLYPH} color={Colors.primaryBlue} />
      </View>
      <ThemedText variant="caption" numberOfLines={2} style={{ textAlign: 'center' }}>
        {tile.label}
      </ThemedText>
      {tile.pro ? (
        <View
          className="bg-chipSurface"
          style={{ position: 'absolute', top: 6, right: 6, paddingHorizontal: 6, borderRadius: 999 }}>
          <ThemedText variant="caption" style={{ color: Colors.primaryBlue, letterSpacing: 0.6 }}>
            PRO
          </ThemedText>
        </View>
      ) : null}
    </PressableScale>
  );
}
