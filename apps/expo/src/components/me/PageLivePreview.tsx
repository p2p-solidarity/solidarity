/**
 * PageLivePreview — the ONE Verified Page rendering in the app, ported from
 * `creds-design/verified-linkinbio-mock-v3.html` (`#s-public` / `.pub`).
 *
 * The same component paints three surfaces so they can never drift:
 *   • the Me tab's page preview          (`variant="editor"`)
 *   • the appearance sheet's live sample (`variant="editor"`)
 *   • a scanned visitor page             (`variant="public"`)
 *
 * Layout follows the mock 1:1 — avatar → name → handle → bio → link cards →
 * block sections → a quiet footer — with only the metrics scaled down for the
 * embedded editor sample. Public mode shows every signed item and opens safe
 * external URLs; editor mode stays a compact sample.
 *
 * Deliberately NOT ported: the mock's per-link "✓ 已驗證" seal. A signed
 * `ProfileLink` carries only `label` + `url`, so there is no per-link check
 * result to render and a decorative seal would be fake data (Rule 8).
 *
 * Row-level pieces live in `PagePreviewItems`, the header/footer in
 * `PagePreviewChrome`, and every measurement in `pagePreviewTheme`.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { PageTemplateColors } from '@/constants/Colors';
import type { PageAppearance, PageBlock } from '@/page/pageDesign';
import type { ProfileRecord } from '@solidarity/shared';

import {
  PagePreviewEmpty,
  PagePreviewFooter,
  PagePreviewHeader,
  PagePreviewSectionTitle,
} from './PagePreviewChrome';
import {
  EmbedPlate,
  FeatureRow,
  ItemCapsule,
  LinkCard,
  MediaTile,
  ShopRow,
  type BlockRenderProps,
} from './PagePreviewItems';
import {
  PREVIEW_METRICS,
  backgroundFor,
  blockItems,
  fontFor,
  paletteFor,
  type PageLivePreviewVariant,
  type PreviewItem,
} from './pagePreviewTheme';
import { ThemedText } from '@/components/themed';

export type { PageLivePreviewVariant } from './pagePreviewTheme';

export interface PageLivePreviewProps {
  readonly record: ProfileRecord;
  readonly blocks: readonly PageBlock[];
  readonly appearance: PageAppearance;
  /** Public mode is the signed visitor surface: show every item and allow
   * safe external URLs to open. Editor mode remains a compact preview. */
  readonly variant?: PageLivePreviewVariant;
  /** Real, already-resolved page address (`creds.id/@name`). Rendered under
   * the display name exactly as the mock's `.pub-handle`; omitted entirely
   * when the caller has no address to show. */
  readonly handle?: string | null;
}

export function PageLivePreview({
  record,
  blocks,
  appearance,
  variant = 'editor',
  handle = null,
}: PageLivePreviewProps): ReactNode {
  const palette = paletteFor(appearance);
  const fontFamily = fontFor(appearance.font);
  const metrics = PREVIEW_METRICS[variant];
  const chrome = { palette, metrics, fontFamily, variant };
  const renderedBlocks = blocks.filter(
    (block) => block.visible
      && (block.type === 'leave-card' || blockItems(block, record).length > 0),
  );

  const content = (
    <View
      style={{
        paddingTop: metrics.padTop,
        paddingHorizontal: metrics.padX,
        paddingBottom: metrics.padBottom,
      }}>
      <PagePreviewHeader record={record} handle={handle} {...chrome} />

      {renderedBlocks.length === 0 ? <PagePreviewEmpty {...chrome} /> : null}

      {renderedBlocks.map((block) => (
        <View key={block.id} style={{ marginTop: metrics.sectionGap }}>
          {block.type === 'links' ? null : (
            <PagePreviewSectionTitle title={block.title} palette={palette} fontFamily={fontFamily} />
          )}
          <PreviewBlockItems
            block={block}
            items={blockItems(block, record)}
            palette={palette}
            metrics={metrics}
            textColor={palette.text}
            fontFamily={fontFamily}
            variant={variant}
          />
        </View>
      ))}

      <PagePreviewFooter appearance={appearance} {...chrome} />
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
      ? [PageTemplateColors.pageGradientStart, PageTemplateColors.pageGradientEnd]
      : [PageTemplateColors.pageSunStart, PageTemplateColors.pageSunEnd];
    return (
      <LinearGradient colors={colors} style={{ borderRadius: 24, overflow: 'hidden' }}>
        {content}
      </LinearGradient>
    );
  }

  const templateBackground = appearance.template === 'night'
    ? PageTemplateColors.pageNight
    : appearance.template === 'mint'
      ? PageTemplateColors.pageMint
      : appearance.template === 'minimal'
        ? PageTemplateColors.cardBg
        : backgroundFor(appearance);
  // `.pub`'s brand ground (mock P27): a low-opacity hero wash behind the
  // header, only on the classic templates that have no colour of their own.
  const showBrandGround = appearance.template === 'cream' || appearance.template === 'journal';
  return (
    <View style={{ borderRadius: 24, overflow: 'hidden', backgroundColor: templateBackground }}>
      {showBrandGround ? (
        <LinearGradient
          colors={[PageTemplateColors.heroGradientStart, PageTemplateColors.heroGradientEnd]}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 220, opacity: 0.5 }}
        />
      ) : null}
      {content}
    </View>
  );
}

function PreviewBlockItems({
  block,
  items,
  ...render
}: BlockRenderProps & {
  readonly block: PageBlock;
  readonly items: readonly PreviewItem[];
}): ReactNode {
  const { palette, metrics, textColor, fontFamily, variant } = render;
  const visibleItems = variant === 'public' ? items : items.slice(0, 3);
  if (visibleItems.length === 0 && block.type !== 'leave-card') return null;

  switch (block.style) {
    case 'plain':
      return (
        <View style={{ gap: 6 }}>
          {visibleItems.map((item) => (
            <ThemedText key={item.id} variant="bodyMedium" style={{ color: textColor, fontFamily }}>
              {item.title}
            </ThemedText>
          ))}
        </View>
      );
    case 'card':
      // `.leave-card` — a bordered, centred panel. A leave-card block carries
      // the CTA capsule; a text block reuses the same panel without one.
      return (
        <View
          style={{
            alignItems: 'center',
            gap: 10,
            padding: 18,
            borderWidth: 1,
            borderColor: palette.cardBorder,
            borderRadius: palette.cardRadius,
            backgroundColor: palette.cardBg,
          }}>
          {visibleItems.map((item) => (
            <ThemedText
              key={item.id}
              variant="bodyMedium"
              style={{ color: textColor, fontFamily, textAlign: 'center' }}>
              {item.title}
            </ThemedText>
          ))}
          {block.type === 'leave-card' ? (
            <ItemCapsule
              item={{ id: block.id, title: block.title }}
              palette={palette}
              fontFamily={fontFamily}
              variant={variant}
              filled
            />
          ) : null}
        </View>
      );
    case 'list':
      return (
        <View style={{ gap: metrics.cardGap }}>
          {visibleItems.map((item) => (
            block.type === 'shop'
              ? <ShopRow key={item.id} item={item} {...render} />
              : <LinkCard key={item.id} item={item} {...render} />
          ))}
        </View>
      );
    case 'grid':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {visibleItems.map((item) => (
            <View
              key={item.id}
              style={{ width: `${100 / metrics.gridColumns}%`, aspectRatio: 1, padding: 4 }}>
              <MediaTile item={item} {...render} />
            </View>
          ))}
        </View>
      );
    case 'carousel': {
      const cards = visibleItems.map((item) => (
        <View key={item.id} style={{ width: 128, height: 128 }}>
          <MediaTile item={item} {...render} />
        </View>
      ));
      // A signed visitor page must expose every signed item, including cards
      // beyond the viewport. The editor remains a compact visual sample.
      return variant === 'public' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {cards}
        </ScrollView>
      ) : <View style={{ flexDirection: 'row', gap: 8, overflow: 'hidden' }}>{cards}</View>;
    }
    case 'large-card':
      // `.fe-card` — 76pt thumbnail beside title + secondary line.
      return (
        <View style={{ gap: metrics.cardGap }}>
          {(variant === 'public' ? visibleItems : visibleItems.slice(0, 1)).map((item) => (
            <FeatureRow key={item.id} item={item} thumbSize={76} {...render} />
          ))}
        </View>
      );
    case 'embed':
      return (
        <View style={{ gap: metrics.cardGap }}>
          {(variant === 'public' ? visibleItems : visibleItems.slice(0, 1)).map((item) => (
            <EmbedPlate
              key={item.id}
              item={item}
              palette={palette}
              fontFamily={fontFamily}
              variant={variant}
            />
          ))}
        </View>
      );
    case 'thumbnail':
      return (
        <View style={{ gap: metrics.cardGap }}>
          {visibleItems.map((item) => (
            <FeatureRow key={item.id} item={item} thumbSize={54} {...render} />
          ))}
        </View>
      );
    case 'button':
      return (
        <View style={{ gap: metrics.cardGap }}>
          {visibleItems.map((item) => (
            <ItemCapsule
              key={item.id}
              item={item}
              palette={palette}
              fontFamily={fontFamily}
              variant={variant}
              filled
            />
          ))}
        </View>
      );
    case 'slots':
      // `.bkslot` — outlined capsules that wrap.
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {visibleItems.map((item) => (
            <ItemCapsule
              key={item.id}
              item={item}
              palette={palette}
              fontFamily={fontFamily}
              variant={variant}
              filled={false}
            />
          ))}
        </View>
      );
    default:
      return null;
  }
}
