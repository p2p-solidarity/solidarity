import { useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Switch, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModalSheet } from '@/components/common/ModalSheet';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import { haptic } from '@/feedback/haptics';
import { fadeUpIn } from '@/feedback/motion';
import { pushToast } from '@/feedback/toast';
import {
  PAGE_BLOCK_CATALOG,
  MAX_PAGE_BLOCK_TITLE_LENGTH,
  MAX_PAGE_ITEM_PRICE_LENGTH,
  MAX_PAGE_ITEM_TITLE_LENGTH,
  MAX_PAGE_ITEMS_PER_BLOCK,
  createInitialPageDesign,
  publicPageDesignEquals,
  toPublicPageDesign,
  type PageAppearance,
  type PageBlock,
  type PageBlockItem,
} from '@/page/pageDesign';
import { preparePageDesign, usePageDesignStore } from '@/page/pageDesignStore';
import { useProGate } from '@/pro/useProGate';

import { PageLivePreview } from './PageLivePreview';
import { PageSectionLabel } from './PageSectionLabel';
import {
  BLOCK_ROW_HEIGHT,
  BLOCK_ROW_STRIDE,
  ICON_TILE_GLYPH,
  ROW_GAP,
  blockRowStyle,
  fieldRowStyle,
  iconTileStyle,
} from './pageRowStyles';
import {
  DraggableRow,
  RowDragHandle,
  resetRowDrag,
  useRowDragController,
  type RowDragController,
} from './rowDrag';
import { useProfileStore } from '@/profile/store';
import { uuid, type ProfileRecord } from '@solidarity/shared';

export interface ProfileSectionsListProps {
  readonly linkCount: number;
  /** The public projection the preview paints — the same record a visitor
   *  would resolve, not the owner's full one. */
  readonly previewRecord: ProfileRecord;
  /** Real page address for the preview's handle line, when one exists. */
  readonly previewHandle: string | null;
}

export function ProfileSectionsList({
  linkCount,
  previewRecord,
  previewHandle,
}: ProfileSectionsListProps): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const status = usePageDesignStore((state) => state.status);
  const error = usePageDesignStore((state) => state.error);
  const design = usePageDesignStore((state) => state.design);
  const blocks = usePageDesignStore((state) => state.design.blocks);
  const setBlockVisible = usePageDesignStore((state) => state.setBlockVisible);
  const moveBlock = usePageDesignStore((state) => state.moveBlock);
  const record = useProfileStore((state) => state.record);
  const savePageDesign = useProfileStore((state) => state.savePageDesign);
  const [editing, setEditing] = useState<PageBlock | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const drag = useRowDragController();
  const publishedDesign = record?.page ?? toPublicPageDesign(createInitialPageDesign());
  const pageHasChanges = status === 'ready' && record !== null && !publicPageDesignEquals(
    toPublicPageDesign(design),
    publishedDesign,
  );
  const movableBlocks = blocks.filter((block) => block.type !== 'links');

  const moveBlockTo = (block: PageBlock, sourceIndex: number, destinationIndex: number): void => {
    if (sourceIndex === destinationIndex) return;
    const direction = destinationIndex < sourceIndex ? 'up' : 'down';
    const distance = Math.abs(destinationIndex - sourceIndex);
    for (let step = 0; step < distance; step += 1) {
      if (direction === 'up') moveBlock(block.id, 'up');
      else moveBlock(block.id, 'down');
    }
  };

  const publishPageChanges = (): void => {
    if (publishing || !record || status !== 'ready') return;
    setPublishing(true);
    void savePageDesign(toPublicPageDesign(design))
      .then((result) => {
        if (result.ok) {
          haptic('success');
          pushToast(t('pageDesign.publishSuccess'), 'success');
          return;
        }
        haptic('error');
        pushToast(t('pageDesign.publishError'), 'error');
      })
      .catch(() => {
        haptic('error');
        pushToast(t('pageDesign.publishError'), 'error');
      })
      .finally(() => { setPublishing(false); });
  };

  return (
    <View className="gap-3 px-4">
      <PageSectionLabel title={t('mePage.sections')} />

      {status === 'loading' ? (
        <ThemedSurface padded className="items-center gap-2">
          <ActivityIndicator color={Colors.primaryBlue} />
          <ThemedText variant="caption" tone="secondary">{t('pageDesign.loading')}</ThemedText>
        </ThemedSurface>
      ) : status === 'error' ? (
        <ThemedSurface padded className="gap-3" style={{ borderColor: Colors.destructive }}>
          <ThemedText variant="bodyMedium">{t('pageDesign.loadError')}</ThemedText>
          <ThemedText variant="caption" tone="secondary">{error ?? t('pageDesign.loadError')}</ThemedText>
          <ThemedButton
            label={t('mePage.retry')}
            variant="secondary"
            onPress={() => { void preparePageDesign(); }}
          />
        </ThemedSurface>
      ) : (
        <>
          {/* The links block always sits first and cannot be reordered or
              switched off, so the mock gives it no controls at all. */}
          <View style={fieldRowStyle(c.mutedSurface)}>
            <View style={iconTileStyle(c.chipSurface)}>
              <SfIcon name="link" size={ICON_TILE_GLYPH} color={Colors.primaryBlue} />
            </View>
            <View className="flex-1" style={{ gap: 1 }}>
              <ThemedText variant="bodyMedium">{t('mePage.links')}</ThemedText>
              <ThemedText variant="caption" tone="tertiary">
                {t('mePage.linkCount', { count: linkCount })}
              </ThemedText>
            </View>
            <ThemedText variant="caption" tone="tertiary">{t('pageDesign.alwaysOn')}</ThemedText>
          </View>

          {/* One tight group: the drag stride reads row travel as
              height + ROW_GAP, so the rows must be spaced by exactly that. */}
          <View style={{ gap: ROW_GAP }}>
            {movableBlocks.map((block, index) => (
              <BlockRow
                key={`${String(index)}-${block.id}`}
                block={block}
                controller={drag}
                index={index}
                itemCount={movableBlocks.length}
                onEdit={() => { setEditing(block); }}
                onVisibleChange={(visible) => { setBlockVisible(block.id, visible); }}
                onMove={(destination) => {
                  moveBlockTo(block, index, destination);
                  // Same-task reset: the committed order and the identity
                  // transforms must reach the UI on the same frame.
                  resetRowDrag(drag);
                }}
                onProPress={openProSettings}
              />
            ))}
          </View>

          {/* No add button here: new sections come from the tab's single
              "＋ 新增" sheet (PageAddSheet), which appends them to this list. */}

          {/* The preview lives here, folded away. Blocks are the only thing on
              this page whose effect you cannot read off the row itself, so
              the "what does it look like" answer belongs with them — and
              stays collapsed so the tab remains a list. */}
          <PagePreviewDisclosure
            open={previewOpen}
            record={previewRecord}
            handle={previewHandle}
            appearance={design.appearance}
            blocks={blocks}
            onToggle={() => { setPreviewOpen((current) => !current); }}
          />

          {pageHasChanges ? (
            <ThemedSurface variant="inset" padded className="gap-3">
              <View className="gap-1">
                <ThemedText variant="bodyMedium">{t('pageDesign.publishChanges')}</ThemedText>
                <ThemedText variant="caption" tone="secondary">
                  {t('pageDesign.publishHint')}
                </ThemedText>
              </View>
              <ThemedButton
                label={t('pageDesign.publishChanges')}
                loading={publishing}
                fullWidth
                onPress={publishPageChanges}
              />
            </ThemedSurface>
          ) : null}
        </>
      )}

      <PageBlockEditorSheet block={editing} onClose={() => { setEditing(null); }} />
    </View>
  );
}

function PagePreviewDisclosure({
  open,
  record,
  handle,
  appearance,
  blocks,
  onToggle,
}: {
  readonly open: boolean;
  readonly record: ProfileRecord;
  readonly handle: string | null;
  readonly appearance: PageAppearance;
  readonly blocks: readonly PageBlock[];
  readonly onToggle: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const reduceMotion = useReducedMotion();
  return (
    <View style={{ gap: open ? 12 : 0 }}>
      <PressableScale
        haptic="tap"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('pageDesign.preview')}
        style={blockRowStyle(c.mutedSurface)}>
        <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
          {t('pageDesign.preview')}
        </ThemedText>
        <SfIcon name={open ? 'chevron.down' : 'chevron.right'} size={13} color={Colors.text3} />
      </PressableScale>
      {open ? (
        // Same entrance as the page's sections: EASE_OUT fade + small rise.
        <Animated.View entering={fadeUpIn(0, reduceMotion)}>
          <PageLivePreview
            record={record}
            blocks={blocks}
            appearance={appearance}
            handle={handle}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function BlockRow({
  block,
  controller,
  index,
  itemCount,
  onEdit,
  onVisibleChange,
  onMove,
  onProPress,
}: {
  readonly block: PageBlock;
  readonly controller: RowDragController;
  readonly index: number;
  readonly itemCount: number;
  readonly onEdit: () => void;
  readonly onVisibleChange: (visible: boolean) => void;
  readonly onMove: (destination: number) => void;
  readonly onProPress: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { locked } = useProGate();
  const catalog = PAGE_BLOCK_CATALOG.find((entry) => entry.type === block.type);
  // Locked only when the catalog requires Pro AND this user is not entitled.
  // A lapsed subscriber's existing block stays here and stays published — the
  // controls go read-only, the content is never touched.
  const proLocked = locked(catalog?.pro ?? false);
  if (!catalog) return null;
  return (
    <DraggableRow
      controller={controller}
      index={index}
      stride={BLOCK_ROW_STRIDE}
      style={{
        ...blockRowStyle(c.mutedSurface),
        gap: 8,
        paddingVertical: 0,
        paddingLeft: 0,
        paddingRight: 12,
      }}>
      <RowDragHandle
        controller={controller}
        label={t('mePage.reorderSection', { title: block.title })}
        index={index}
        itemCount={itemCount}
        stride={BLOCK_ROW_STRIDE}
        height={BLOCK_ROW_HEIGHT}
        disabled={proLocked}
        onMove={proLocked ? () => { onProPress(); } : onMove}
      />
      <PressableScale
        fill
        onPress={proLocked ? onProPress : onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('pageDesign.editSection', { title: block.title })}
        accessibilityHint={proLocked ? t('pageDesign.proControl') : undefined}
        className="flex-row items-center gap-2 py-1">
        <View className="flex-1 gap-0.5">
          <ThemedText variant="bodyMedium">{block.title}</ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            {t('pageDesign.itemCount', { count: block.items.length })}{proLocked ? ' · PRO' : ''}
          </ThemedText>
        </View>
      </PressableScale>
      <Switch
        value={block.visible}
        style={{ alignSelf: 'center' }}
        accessibilityLabel={t('pageDesign.sectionVisible', { title: block.title })}
        accessibilityHint={proLocked ? t('pageDesign.proControl') : undefined}
        onValueChange={proLocked ? onProPress : onVisibleChange}
        trackColor={{ true: Colors.primaryBlue }}
      />
    </DraggableRow>
  );
}

function openProSettings(): void {
  router.push('/settings/pro');
}

function PageBlockEditorSheet({ block, onClose }: { readonly block: PageBlock | null; readonly onClose: () => void }): ReactNode {
  if (block === null) return null;
  return <PageBlockEditorContent key={block.id} block={block} onClose={onClose} />;
}

function PageBlockEditorContent({ block, onClose }: { readonly block: PageBlock; readonly onClose: () => void }): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const updateBlock = usePageDesignStore((state) => state.updateBlock);
  const removeBlock = usePageDesignStore((state) => state.removeBlock);
  const [title, setTitle] = useState(block.title);
  const [style, setStyle] = useState(block.style);
  const [items, setItems] = useState<readonly PageBlockItem[]>(block.items);
  const catalog = PAGE_BLOCK_CATALOG.find((entry) => entry.type === block.type);
  if (!catalog) return null;
  const save = () => {
    updateBlock(block.id, {
      title,
      style,
      items: items
        .filter((item) => item.title.trim().length > 0)
        .map((item) => ({
          ...item,
          title: item.title.trim(),
          ...(item.url?.trim() ? { url: item.url.trim() } : { url: undefined }),
          ...(item.price?.trim() ? { price: item.price.trim() } : { price: undefined }),
        })),
    });
    onClose();
  };
  return (
    <ModalSheet visible onRequestClose={onClose}>
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          bottomOffset={16}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 18 }}>
          <ThemedText variant="titleLarge">{t('pageDesign.editSectionTitle')}</ThemedText>
          <ThemedTextInput
            label={t('pageDesign.sectionTitle')}
            value={title}
            maxLength={MAX_PAGE_BLOCK_TITLE_LENGTH}
            onChangeText={setTitle}
            showClear
          />

          <View className="gap-2">
            <ThemedText variant="label" tone="tertiary">{t('pageDesign.items')}</ThemedText>
            {items.map((item) => (
              <ThemedSurface key={item.id} padded className="gap-3">
                <ThemedTextInput
                  label={t('pageDesign.itemTitle')}
                  value={item.title}
                  maxLength={MAX_PAGE_ITEM_TITLE_LENGTH}
                  onChangeText={(nextTitle) => {
                    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, title: nextTitle } : candidate));
                  }}
                  showClear
                />
                <ThemedTextInput
                  kind="url"
                  label={t('pageDesign.itemUrl')}
                  value={item.url ?? ''}
                  onChangeText={(url) => {
                    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, url } : candidate));
                  }}
                  showClear
                />
                {block.type === 'shop' ? (
                  <ThemedTextInput
                    label={t('pageDesign.itemPrice')}
                    value={item.price ?? ''}
                    maxLength={MAX_PAGE_ITEM_PRICE_LENGTH}
                    onChangeText={(price) => {
                      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, price } : candidate));
                    }}
                    showClear
                  />
                ) : null}
                <ThemedButton
                  label={t('pageDesign.removeItem')}
                  variant="destructive"
                  size="sm"
                  onPress={() => { setItems((current) => current.filter((candidate) => candidate.id !== item.id)); }}
                />
              </ThemedSurface>
            ))}
            <ThemedButton
              label={t('pageDesign.addItem')}
              variant="secondary"
              fullWidth
              disabled={items.length >= MAX_PAGE_ITEMS_PER_BLOCK}
              onPress={() => { setItems((current) => [...current, { id: uuid(), title: '' }]); }}
            />
          </View>

          <View className="gap-2">
            <ThemedText variant="label" tone="tertiary">{t('pageDesign.style')}</ThemedText>
            <View className="flex-row flex-wrap gap-2">
              {catalog.styles.map((option) => (
                <PressableScale
                  key={option}
                  onPress={() => { setStyle(option); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: style === option }}
                  style={{
                    minHeight: 44,
                    paddingHorizontal: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderRadius: 12,
                    borderColor: style === option ? Colors.primaryBlue : Colors.divider,
                    backgroundColor: style === option ? Colors.chipSurface : Colors.cardBg,
                  }}>
                  <ThemedText variant="label">{t(`pageDesign.style.${option}`)}</ThemedText>
                </PressableScale>
              ))}
            </View>
          </View>

          <ThemedButton label={t('common.save')} fullWidth disabled={!title.trim()} onPress={save} />
          <ThemedButton
            label={t('pageDesign.removeSection')}
            variant="destructive"
            fullWidth
            onPress={() => { removeBlock(block.id); onClose(); }}
          />
          <ThemedButton label={t('common.cancel')} variant="secondary" fullWidth onPress={onClose} />
        </KeyboardAwareScrollView>
      </View>
    </ModalSheet>
  );
}
