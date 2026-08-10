import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { readableTextOn, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { PageAppearance, PageBlock, PageBlockItem } from '@/page/pageDesign';
import { isRenderableLinkUrl, type ProfileRecord } from '@solidarity/shared';

export type PageLivePreviewVariant = 'editor' | 'public';

export interface PageLivePreviewProps {
  readonly record: ProfileRecord;
  readonly blocks: readonly PageBlock[];
  readonly appearance: PageAppearance;
  /** Public mode is the signed visitor surface: show every item and allow
   * safe external URLs to open. Editor mode remains a compact preview. */
  readonly variant?: PageLivePreviewVariant;
}

function backgroundFor(appearance: PageAppearance): string {
  if (appearance.customBackground) return appearance.customBackground;
  switch (appearance.background) {
    case 'white': return Colors.cardBg;
    case 'mint': return Colors.pageMint;
    case 'rose': return Colors.pageRose;
    case 'ink': return Colors.pageInk;
    default: return Colors.warmCream;
  }
}

function textFor(appearance: PageAppearance): string {
  if (appearance.customBackground) return readableTextOn(appearance.customBackground);
  return appearance.template === 'ink' || appearance.template === 'night' || appearance.template === 'gradient' || appearance.background === 'ink'
    ? Colors.pageLightText
    : Colors.text1;
}

function fontFor(font: PageAppearance['font']): string | undefined {
  switch (font) {
    case 'serif': return 'Georgia';
    case 'rounded': return 'Arial Rounded MT Bold';
    case 'mincho': return 'Hiragino Mincho ProN';
    case 'mono': return 'Courier';
    default: return undefined;
  }
}

export function PageLivePreview({
  record,
  blocks,
  appearance,
  variant = 'editor',
}: PageLivePreviewProps): ReactNode {
  const { t } = useTranslation();
  const textColor = textFor(appearance);
  const fontFamily = fontFor(appearance.font);
  const visibleBlocks = blocks.filter((block) => block.visible);
  const content = (
    <View style={{ gap: 12, padding: 18 }}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: Colors.pagePreviewGlass,
          }}>
          <ThemedText variant="titleMedium" style={{ color: textColor, fontFamily }}>
            {(record.displayName.trim().charAt(0) || '?').toUpperCase()}
          </ThemedText>
        </View>
        <ThemedText variant="titleMedium" style={{ color: textColor, fontFamily }}>
          {record.displayName || t('mePage.unnamed')}
        </ThemedText>
        {record.bio ? (
          <ThemedText variant="caption" style={{ color: textColor, fontFamily, textAlign: 'center' }}>
            {record.bio}
          </ThemedText>
        ) : null}
      </View>

      {visibleBlocks.map((block) => {
        const items = block.type === 'links'
          ? record.links.map((link) => ({ id: link.url, title: link.label, url: link.url }))
          : block.items;
        if (block.type !== 'leave-card' && items.length === 0) return null;
        return (
          <ThemedSurface
            key={block.id}
            variant="card"
            style={{
              gap: 8,
              padding: 12,
              borderColor: Colors.pagePreviewBorder,
              backgroundColor: Colors.pagePreviewGlass,
            }}>
            <ThemedText variant="label" style={{ color: textColor, fontFamily }}>
              {block.title}
            </ThemedText>
            <PreviewBlockItems
              block={block}
              items={items}
              textColor={textColor}
              fontFamily={fontFamily}
              variant={variant}
            />
          </ThemedSurface>
        );
      })}

      {appearance.footerText ? (
        <ThemedText variant="caption" style={{ color: textColor, fontFamily, textAlign: 'center' }}>
          {appearance.footerText}
        </ThemedText>
      ) : appearance.showBrand ? (
        <ThemedText variant="caption" style={{ color: textColor, fontFamily, textAlign: 'center' }}>
          creds.id
        </ThemedText>
      ) : null}
    </View>
  );

  // A custom color is an explicit override. Apply it before template
  // backgrounds so every preview responds immediately to the control.
  if (appearance.customBackground) {
    return (
      <View
        style={{
          borderRadius: 24,
          overflow: 'hidden',
          backgroundColor: appearance.customBackground,
        }}>
        {content}
      </View>
    );
  }

  if (appearance.template === 'gradient' || appearance.template === 'sun') {
    const colors: readonly [string, string] = appearance.template === 'gradient'
      ? [Colors.pageGradientStart, Colors.pageGradientEnd]
      : [Colors.pageSunStart, Colors.pageSunEnd];
    return (
      <LinearGradient colors={colors} style={{ borderRadius: 24, overflow: 'hidden' }}>
        {content}
      </LinearGradient>
    );
  }

  const templateBackground = appearance.template === 'night'
    ? Colors.pageNight
    : appearance.template === 'mint'
      ? Colors.pageMint
      : appearance.template === 'minimal'
        ? Colors.cardBg
        : backgroundFor(appearance);
  return <View style={{ borderRadius: 24, overflow: 'hidden', backgroundColor: templateBackground }}>{content}</View>;
}

type PreviewItem = Pick<PageBlockItem, 'id' | 'title' | 'url' | 'media' | 'price'>;

function PreviewBlockItems({
  block,
  items,
  textColor,
  fontFamily,
  variant,
}: {
  readonly block: PageBlock;
  readonly items: readonly PreviewItem[];
  readonly textColor: string;
  readonly fontFamily: string | undefined;
  readonly variant: PageLivePreviewVariant;
}): ReactNode {
  const visibleItems = variant === 'public' ? items : items.slice(0, 3);
  if (visibleItems.length === 0) return null;

  switch (block.style) {
    case 'plain':
      return (
        <View style={{ gap: 4 }}>
          {visibleItems.map((item) => (
            <ItemLabel key={item.id} item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
          ))}
        </View>
      );
    case 'card':
    case 'list':
      return (
        <View style={{ gap: 7 }}>
          {visibleItems.map((item) => (
            <PreviewItemCard key={item.id} item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
          ))}
        </View>
      );
    case 'grid':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {visibleItems.map((item) => (
            <View
              key={item.id}
              style={{
                width: '48%',
                minHeight: 64,
                justifyContent: 'center',
                padding: 9,
                borderRadius: 12,
                backgroundColor: Colors.pagePreviewGlass,
              }}>
              <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
            </View>
          ))}
        </View>
      );
    case 'carousel': {
      const cards = visibleItems.map((item) => (
        <View
          key={item.id}
          style={{
            width: 128,
            minHeight: 76,
            justifyContent: 'flex-end',
            padding: 10,
            borderRadius: 12,
            backgroundColor: Colors.pagePreviewGlass,
          }}>
          <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
        </View>
      ));
      // A signed visitor page must expose every signed item, including cards
      // beyond the viewport. The editor remains a compact visual sample.
      return variant === 'public' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
          {cards}
        </ScrollView>
      ) : <View style={{ flexDirection: 'row', gap: 7, overflow: 'hidden' }}>{cards}</View>;
    }
    case 'large-card': {
      return (
        <View style={{ gap: 7 }}>
          {(variant === 'public' ? visibleItems : visibleItems.slice(0, 1)).map((item) => (
            <View
              key={item.id}
              style={{
                minHeight: 104,
                justifyContent: 'flex-end',
                padding: 12,
                borderRadius: 14,
                backgroundColor: Colors.pagePreviewGlass,
              }}>
              <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
            </View>
          ))}
        </View>
      );
    }
    case 'embed': {
      return (
        <View style={{ gap: 7 }}>
          {(variant === 'public' ? visibleItems : visibleItems.slice(0, 1)).map((item) => (
            <View
              key={item.id}
              style={{
                aspectRatio: 16 / 9,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: 12,
                borderRadius: 14,
                backgroundColor: Colors.pagePreviewGlass,
              }}>
              <ThemedText variant="titleMedium" style={{ color: textColor, fontFamily }}>▶</ThemedText>
              <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} centered />
            </View>
          ))}
        </View>
      );
    }
    case 'thumbnail':
      return (
        <View style={{ gap: 7 }}>
          {visibleItems.map((item) => (
            <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
              </View>
            </View>
          ))}
        </View>
      );
    case 'button':
      return (
        <View style={{ gap: 7 }}>
          {visibleItems.map((item) => (
            <View
              key={item.id}
              style={{
                minHeight: 40,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: Colors.pagePreviewGlass,
              }}>
              <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} centered />
            </View>
          ))}
        </View>
      );
    case 'slots':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {visibleItems.map((item) => (
            <View
              key={item.id}
              style={{
                minHeight: 34,
                justifyContent: 'center',
                paddingHorizontal: 10,
                borderRadius: 10,
                backgroundColor: Colors.pagePreviewGlass,
              }}>
              <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
            </View>
          ))}
        </View>
      );
    default:
      return null;
  }
}

function PreviewItemCard({
  item,
  textColor,
  fontFamily,
  variant,
}: {
  readonly item: PreviewItem;
  readonly textColor: string;
  readonly fontFamily: string | undefined;
  readonly variant: PageLivePreviewVariant;
}): ReactNode {
  return (
    <View
      style={{
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: Colors.pagePreviewGlass,
      }}>
      <ItemLabel item={item} textColor={textColor} fontFamily={fontFamily} variant={variant} />
    </View>
  );
}

function ItemLabel({
  item,
  textColor,
  fontFamily,
  variant,
  centered = false,
}: {
  readonly item: PreviewItem;
  readonly textColor: string;
  readonly fontFamily: string | undefined;
  readonly variant: PageLivePreviewVariant;
  readonly centered?: boolean;
}): ReactNode {
  const mediaUrl = item.media && isRenderableLinkUrl(item.media) ? item.media : null;
  const content = (
    <View
      style={{
        flexDirection: mediaUrl ? 'row' : 'column',
        alignItems: mediaUrl ? 'center' : undefined,
        gap: mediaUrl ? 8 : 1,
      }}>
      {mediaUrl ? (
        <Image
          source={{ uri: mediaUrl }}
          contentFit="cover"
          accessibilityLabel={item.title}
          style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: Colors.pagePreviewGlass }}
        />
      ) : null}
      <View style={{ flex: mediaUrl ? 1 : undefined, gap: 1 }}>
        <ThemedText
          variant="caption"
          numberOfLines={1}
          style={{ color: textColor, fontFamily, textAlign: centered ? 'center' : 'left' }}>
          {item.title}
        </ThemedText>
        {item.price ? (
          <ThemedText
            variant="caption"
            numberOfLines={1}
            style={{ color: textColor, fontFamily, opacity: 0.76, textAlign: centered ? 'center' : 'left' }}>
            {item.price}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
  const url = variant === 'public' && item.url && isRenderableLinkUrl(item.url) ? item.url : null;
  if (!url) return content;
  return (
    <PressableScale
      haptic="tap"
      accessibilityRole="link"
      accessibilityLabel={item.title.trim() || url}
      onPress={() => { void Linking.openURL(url).catch(() => undefined); }}>
      {content}
    </PressableScale>
  );
}
