import { useMemo, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Modal, ScrollView, Switch, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import { haptic } from '@/feedback/haptics';
import { SPRING } from '@/feedback/motion';
import { pushToast } from '@/feedback/toast';
import {
  PAGE_BLOCK_CATALOG,
  MAX_PAGE_BLOCK_COUNT,
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
  type PageBlockType,
} from '@/page/pageDesign';
import { preparePageDesign, usePageDesignStore } from '@/page/pageDesignStore';

import { PageLivePreview } from './PageLivePreview';
import { PageSectionLabel } from './PageSectionLabel';
import {
  ROW_GAP,
  blockRowStyle,
  dragDestinationIndex,
  fieldRowStyle,
  iconTileStyle,
} from './pageRowStyles';
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

/** Reveal duration for the folded preview — same 240ms as the page entrance. */
const PREVIEW_REVEAL_MS = 240;
const BLOCK_ROW_STRIDE = 56 + ROW_GAP;

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<PageBlock | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
              <SfIcon name="link" size={22} color={Colors.primaryBlue} />
            </View>
            <View className="flex-1" style={{ gap: 1 }}>
              <ThemedText variant="bodyMedium">{t('mePage.links')}</ThemedText>
              <ThemedText variant="caption" tone="tertiary">
                {t('mePage.linkCount', { count: linkCount })}
              </ThemedText>
            </View>
            <ThemedText variant="caption" tone="tertiary">{t('pageDesign.alwaysOn')}</ThemedText>
          </View>

          {movableBlocks.map((block, index) => (
            <BlockRow
              key={block.id}
              block={block}
              index={index}
              itemCount={movableBlocks.length}
              onEdit={() => { setEditing(block); }}
              onVisibleChange={(visible) => { setBlockVisible(block.id, visible); }}
              onMove={(destination) => { moveBlockTo(block, index, destination); }}
              onProPress={openProSettings}
            />
          ))}

          <ThemedButton
            label={t('pageDesign.addSection')}
            variant="secondary"
            fullWidth
            disabled={blocks.length >= MAX_PAGE_BLOCK_COUNT}
            onPress={() => { setPickerOpen(true); }}
          />

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

      <PageBlockPickerSheet
        visible={pickerOpen}
        onClose={() => { setPickerOpen(false); }}
        onOpenPro={openProSettings}
      />
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
        <Animated.View entering={FadeIn.duration(PREVIEW_REVEAL_MS)}>
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
  index,
  itemCount,
  onEdit,
  onVisibleChange,
  onMove,
  onProPress,
}: {
  readonly block: PageBlock;
  readonly index: number;
  readonly itemCount: number;
  readonly onEdit: () => void;
  readonly onVisibleChange: (visible: boolean) => void;
  readonly onMove: (destination: number) => void;
  readonly onProPress: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const catalog = PAGE_BLOCK_CATALOG.find((entry) => entry.type === block.type);
  if (!catalog) return null;
  return (
    <View style={{ ...blockRowStyle(c.mutedSurface), gap: 0, padding: 0 }}>
      <BlockReorderHandle
        label={t('mePage.reorderSection', { title: block.title })}
        index={index}
        itemCount={itemCount}
        onMove={catalog.pro ? () => { onProPress(); } : onMove}
      />
      <PressableScale
        fill
        onPress={catalog.pro ? onProPress : onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('pageDesign.editSection', { title: block.title })}
        accessibilityHint={catalog.pro ? t('pageDesign.proControl') : undefined}
        className="flex-row items-center gap-2 py-2">
        <View className="flex-1 gap-0.5">
          <ThemedText variant="bodyMedium">{block.title}</ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            {t('pageDesign.itemCount', { count: block.items.length })}{catalog.pro ? ' · PRO' : ''}
          </ThemedText>
        </View>
        <SfIcon name="chevron.right" size={13} color={Colors.text3} />
      </PressableScale>
      <Switch
        value={block.visible}
        accessibilityLabel={t('pageDesign.sectionVisible', { title: block.title })}
        accessibilityHint={catalog.pro ? t('pageDesign.proControl') : undefined}
        onValueChange={catalog.pro ? onProPress : onVisibleChange}
        trackColor={{ true: Colors.primaryBlue }}
      />
    </View>
  );
}

function BlockReorderHandle({
  label,
  index,
  itemCount,
  onMove,
}: {
  readonly label: string;
  readonly index: number;
  readonly itemCount: number;
  readonly onMove: (destination: number) => void;
}): ReactNode {
  const translationY = useSharedValue(0);
  const lift = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    zIndex: lift.value > 1 ? 2 : 0,
    transform: [
      { translateY: translationY.value },
      { scale: lift.value },
    ],
  }));
  const pan = useMemo(
    () => Gesture.Pan()
      .activateAfterLongPress(120)
      .onStart(() => {
        lift.value = withSpring(1.05, SPRING.zoom);
      })
      .onUpdate((event) => {
        translationY.value = event.translationY;
      })
      .onEnd((event) => {
        const destination = dragDestinationIndex(
          index,
          event.translationY,
          itemCount,
          BLOCK_ROW_STRIDE,
        );
        if (destination !== index) scheduleOnRN(onMove, destination);
      })
      .onFinalize(() => {
        translationY.value = withSpring(0, SPRING.gentle);
        lift.value = withSpring(1, SPRING.press);
      }),
    [index, itemCount, lift, onMove, translationY],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityActions={[
          { name: 'decrement', label },
          { name: 'increment', label },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement' && index > 0) onMove(index - 1);
          if (event.nativeEvent.actionName === 'increment' && index < itemCount - 1) onMove(index + 1);
        }}
        style={[
          { width: 44, height: 56, alignItems: 'center', justifyContent: 'center' },
          animatedStyle,
        ]}>
        <Svg width={18} height={24} viewBox="0 0 18 24" fill="none">
          {[6, 12, 18].flatMap((cy) => [6, 12].map((cx) => (
            <Circle
              key={`${String(cx)}-${String(cy)}`}
              cx={cx}
              cy={cy}
              r={1.4}
              fill={Colors.text3}
            />
          )))}
        </Svg>
      </Animated.View>
    </GestureDetector>
  );
}

function PageBlockPickerSheet({
  visible,
  onClose,
  onOpenPro,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onOpenPro: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const addBlock = usePageDesignStore((state) => state.addBlock);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <ThemedText variant="titleLarge">{t('pageDesign.addSection')}</ThemedText>
          {PAGE_BLOCK_CATALOG.filter((entry) => entry.type !== 'links').map((entry) => (
              <PressableScale
                key={entry.type}
                onPress={() => {
                  if (entry.pro) {
                    onClose();
                    onOpenPro();
                    return;
                  }
                  addBlock(entry.type as Exclude<PageBlockType, 'links'>, t(`pageDesign.block.${entry.type}`));
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityHint={entry.pro ? t('pageDesign.proControl') : undefined}
                className="min-h-14 flex-row items-center gap-3 rounded-2xl border border-divider bg-cardBg px-4 py-3">
                <ThemedText variant="titleMedium">{blockSymbol(entry.type)}</ThemedText>
                <View className="flex-1">
                  <ThemedText variant="bodyMedium">{t(`pageDesign.block.${entry.type}`)}</ThemedText>
                  <ThemedText variant="caption" tone="tertiary">
                    {entry.pro ? 'PRO' : t('pageDesign.basicSection')}
                  </ThemedText>
                </View>
              </PressableScale>
            ))}
          <ThemedButton label={t('common.close')} variant="secondary" fullWidth onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
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
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 18 }}>
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
        </ScrollView>
      </View>
    </Modal>
  );
}

function blockSymbol(type: PageBlockType): string {
  switch (type) {
    case 'links': return '🔗';
    case 'text': return '¶';
    case 'portfolio': return '▦';
    case 'featured': return '★';
    case 'video': return '▶';
    case 'shop': return '◇';
    case 'leave-card': return '↙';
    case 'booking': return '□';
  }
}
