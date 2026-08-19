/**
 * Row-level pieces of the Verified Page preview, ported from the mock's
 * `.link-card`, `.shop`, `.fe-card`, `.vid` and `.pf`
 * (`creds-design/verified-linkinbio-mock-v3.html` §`#s-public`).
 *
 * `ItemPressable` is the single navigation boundary: only the visitor surface
 * opens URLs, and only after `isRenderableLinkUrl` re-checks a locally edited
 * draft that has not been through `parseProfile`.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { BrandIcon } from '@/components/icons/BrandIcon';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { PageTemplateColors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { brandIconForLink } from '@/profile/linkPresentation';
import { isRenderableLinkUrl } from '@solidarity/shared';

import {
  previewCardStyle,
  type PageLivePreviewVariant,
  type PagePalette,
  type PreviewItem,
  type PreviewMetrics,
} from './pagePreviewTheme';

export interface BlockRenderProps {
  readonly palette: PagePalette;
  readonly metrics: PreviewMetrics;
  readonly textColor: string;
  readonly fontFamily: string | undefined;
  readonly variant: PageLivePreviewVariant;
}

/** Opens a signed item's URL on the visitor surface; inert in the editor. */
export function ItemPressable({
  item,
  variant,
  fill = false,
  children,
}: {
  readonly item: PreviewItem;
  readonly variant: PageLivePreviewVariant;
  readonly fill?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { t } = useTranslation();
  const url = variant === 'public' && item.url && isRenderableLinkUrl(item.url) ? item.url : null;
  if (!url) return <>{children}</>;
  return (
    <PressableScale
      haptic="tap"
      accessibilityRole="link"
      accessibilityLabel={item.title.trim() || url}
      fill={fill}
      style={fill ? { flex: 1 } : undefined}
      onPress={() => {
        void Linking.openURL(url).catch(() => {
          appAlert({
            title: t('mePage.linkErrorTitle'),
            message: t('mePage.linkErrorMessage'),
          });
        });
      }}>
      {children}
    </PressableScale>
  );
}

/** The item's secondary line — a shop price, when the item carries one. */
function ItemPrice({
  item,
  palette,
  fontFamily,
}: {
  readonly item: PreviewItem;
  readonly palette: PagePalette;
  readonly fontFamily: string | undefined;
}): ReactNode {
  if (!item.price) return null;
  return (
    <ThemedText
      variant="caption"
      numberOfLines={1}
      style={{ color: palette.subtle, opacity: palette.subtleOpacity, fontFamily }}>
      {item.price}
    </ThemedText>
  );
}

/** `.pf` — a square media tile. Without artwork it stays a flat, labelled
 *  slot: the item is real, only its image is missing. */
export function MediaTile({
  item,
  palette,
  textColor,
  fontFamily,
  variant,
  hideLabel = false,
}: BlockRenderProps & { readonly item: PreviewItem; readonly hideLabel?: boolean }): ReactNode {
  const mediaUrl = item.media && isRenderableLinkUrl(item.media) ? item.media : null;
  return (
    <ItemPressable item={item} variant={variant} fill>
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          overflow: 'hidden',
          padding: 8,
          borderRadius: palette.cardRadius,
          backgroundColor: palette.placeholder,
        }}>
        {mediaUrl ? (
          <Image
            source={{ uri: mediaUrl }}
            contentFit="cover"
            accessibilityLabel={item.title}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />
        ) : null}
        {hideLabel || mediaUrl ? null : (
          <ThemedText variant="caption" numberOfLines={2} style={{ color: textColor, fontFamily }}>
            {item.title}
          </ThemedText>
        )}
      </View>
    </ItemPressable>
  );
}

/** `.link-card` — icon tile, title, mono URL. The page's primary row. */
export function LinkCard({
  item,
  ...render
}: BlockRenderProps & { readonly item: PreviewItem }): ReactNode {
  const { palette, metrics, textColor, fontFamily, variant } = render;
  const mediaUrl = item.media && isRenderableLinkUrl(item.media) ? item.media : null;
  const displayUrl = item.url ? item.url.replace(/^https?:\/\//u, '') : null;
  return (
    <ItemPressable item={item} variant={variant}>
      <View style={previewCardStyle(palette, metrics)}>
        <View
          style={{
            width: metrics.linkIcon,
            height: metrics.linkIcon,
            borderRadius: 2,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.iconBg,
          }}>
          {mediaUrl ? (
            <Image
              source={{ uri: mediaUrl }}
              contentFit="cover"
              accessibilityLabel={item.title}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <BrandIcon
              name={brandIconForLink(item.title, item.url ?? '')}
              size={metrics.linkIcon >= 44 ? 22 : 18}
              color={palette.iconTint}
            />
          )}
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <ThemedText variant="bodyLarge" numberOfLines={1} style={{ color: textColor, fontFamily }}>
            {item.title}
          </ThemedText>
          {displayUrl ? (
            <ThemedText
              variant="caption"
              numberOfLines={1}
              style={{ color: palette.subtle, opacity: palette.subtleOpacity, fontFamily: 'Menlo' }}>
              {displayUrl}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </ItemPressable>
  );
}

/** `.shop` — thumbnail, title + price, and a buy capsule. */
export function ShopRow({
  item,
  ...render
}: BlockRenderProps & { readonly item: PreviewItem }): ReactNode {
  const { t } = useTranslation();
  const { palette, metrics, fontFamily, textColor, variant } = render;
  return (
    <ItemPressable item={item} variant={variant}>
      <View style={previewCardStyle(palette, metrics)}>
        <View style={{ width: 54, height: 54 }}>
          <MediaTile item={item} {...render} hideLabel />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <ThemedText variant="bodyMedium" numberOfLines={2} style={{ color: textColor, fontFamily }}>
            {item.title}
          </ThemedText>
          <ItemPrice item={item} palette={palette} fontFamily={fontFamily} />
        </View>
        {item.url && isRenderableLinkUrl(item.url) ? (
          <View
            style={{
              minHeight: 32,
              justifyContent: 'center',
              paddingHorizontal: 16,
              borderRadius: 999,
              backgroundColor: PageTemplateColors.invertedButtonBg,
            }}>
            <ThemedText variant="caption" style={{ color: PageTemplateColors.invertedButtonText, fontFamily }}>
              {t('pageDesign.previewBuy')}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </ItemPressable>
  );
}

/** `.fe-card` — square thumbnail beside a two-line main column. */
export function FeatureRow({
  item,
  thumbSize,
  ...render
}: BlockRenderProps & { readonly item: PreviewItem; readonly thumbSize: number }): ReactNode {
  const { palette, metrics, textColor, fontFamily, variant } = render;
  return (
    <ItemPressable item={item} variant={variant}>
      <View style={previewCardStyle(palette, metrics)}>
        <View style={{ width: thumbSize, height: thumbSize }}>
          <MediaTile item={item} {...render} hideLabel />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText variant="bodyMedium" numberOfLines={2} style={{ color: textColor, fontFamily }}>
            {item.title}
          </ThemedText>
          <ItemPrice item={item} palette={palette} fontFamily={fontFamily} />
        </View>
      </View>
    </ItemPressable>
  );
}

/** `.vid` — 16:9 dark plate carrying the play glyph over the item title. */
export function EmbedPlate({
  item,
  palette,
  fontFamily,
  variant,
}: Omit<BlockRenderProps, 'textColor' | 'metrics'> & { readonly item: PreviewItem }): ReactNode {
  const mediaUrl = item.media && isRenderableLinkUrl(item.media) ? item.media : null;
  return (
    <ItemPressable item={item} variant={variant}>
      <View
        style={{
          aspectRatio: 16 / 9,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 12,
          overflow: 'hidden',
          borderRadius: palette.cardRadius,
          backgroundColor: PageTemplateColors.pageInk,
        }}>
        {mediaUrl ? (
          <Image
            source={{ uri: mediaUrl }}
            contentFit="cover"
            accessibilityLabel={item.title}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />
        ) : null}
        <SfIcon name="play.rectangle.fill" size={28} color={PageTemplateColors.pageLightText} />
        <ThemedText
          variant="caption"
          numberOfLines={1}
          style={{ color: PageTemplateColors.pageLightText, fontFamily, textAlign: 'center' }}>
          {item.title}
        </ThemedText>
      </View>
    </ItemPressable>
  );
}

/** A pill row (`leave-card`'s button style) and the booking `.bkslot` chips. */
export function ItemCapsule({
  item,
  palette,
  fontFamily,
  variant,
  filled,
}: Omit<BlockRenderProps, 'textColor' | 'metrics'> & {
  readonly item: PreviewItem;
  readonly filled: boolean;
}): ReactNode {
  return (
    <ItemPressable item={item} variant={variant}>
      <View
        style={filled ? {
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 22,
          borderRadius: 999,
          backgroundColor: PageTemplateColors.invertedButtonBg,
        } : {
          minHeight: 34,
          justifyContent: 'center',
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: palette.cardBorder,
          backgroundColor: palette.cardBg,
        }}>
        <ThemedText
          variant={filled ? 'bodyLarge' : 'bodySmall'}
          numberOfLines={1}
          style={{ color: filled ? PageTemplateColors.invertedButtonText : palette.text, fontFamily }}>
          {item.title}
        </ThemedText>
      </View>
    </ItemPressable>
  );
}
