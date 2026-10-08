/**
 * Verified Page preview theme — the `.pub` numbers and colours from
 * `creds-design/verified-linkinbio-mock-v3.html`, kept out of the components
 * so the editor sample and the visitor page can never drift apart.
 */
import { ON_DARK, readableTextOn } from '@/components/themed';
import { PageTemplateColors } from '@/constants/Colors';
import type { PageAppearance, PageBlock, PageBlockItem, PageTemplateId } from '@/page/pageDesign';
import type { ProfileRecord } from '@solidarity/shared';
import type { ViewStyle } from 'react-native';

export type PageLivePreviewVariant = 'editor' | 'public';

export type PreviewItem = Pick<PageBlockItem, 'id' | 'title' | 'url' | 'media' | 'price'>;

/** `.pub` metrics, and the same layout at embedded-editor density. */
export interface PreviewMetrics {
  readonly padTop: number;
  readonly padX: number;
  readonly padBottom: number;
  readonly avatar: number;
  readonly headerGap: number;
  readonly bioGap: number;
  readonly linkIcon: number;
  readonly cardPadV: number;
  readonly cardPadH: number;
  readonly cardGap: number;
  readonly sectionGap: number;
  readonly footerGap: number;
  readonly gridColumns: number;
}

export const PREVIEW_METRICS: Readonly<Record<PageLivePreviewVariant, PreviewMetrics>> = {
  public: {
    padTop: 52,
    padX: 24,
    padBottom: 40,
    avatar: 92,
    headerGap: 18,
    bioGap: 18,
    linkIcon: 44,
    cardPadV: 15,
    cardPadH: 16,
    cardGap: 12,
    sectionGap: 26,
    footerGap: 72,
    gridColumns: 3,
  },
  editor: {
    padTop: 24,
    padX: 16,
    padBottom: 18,
    avatar: 64,
    headerGap: 12,
    bioGap: 12,
    linkIcon: 36,
    cardPadV: 11,
    cardPadH: 12,
    cardGap: 9,
    sectionGap: 20,
    footerGap: 26,
    gridColumns: 3,
  },
};

/** `--radiusCard` per template — the mock gives each template its own card
 *  silhouette (classic square, minimal 8, night 16, gradient 20, mint/sun 22). */
const TEMPLATE_CARD_RADIUS: Readonly<Record<PageTemplateId, number>> = {
  cream: 0,
  ink: 0,
  journal: 0,
  gradient: 20,
  night: 16,
  mint: 22,
  sun: 22,
  minimal: 8,
};

/** Resolved surface treatment for one appearance: the mock's default `.pub`
 *  cards on light templates, its translucent `.t-grad` cards on dark ones. */
export interface PagePalette {
  readonly text: string;
  readonly subtle: string;
  readonly subtleOpacity: number;
  readonly cardBg: string;
  readonly cardBorder: string;
  readonly cardRadius: number;
  readonly iconBg: string;
  readonly iconTint: string;
  readonly placeholder: string;
  readonly onDark: boolean;
}

export function backgroundFor(appearance: PageAppearance): string {
  if (appearance.customBackground) return appearance.customBackground;
  switch (appearance.background) {
    case 'white': return PageTemplateColors.cardBg;
    case 'mint': return PageTemplateColors.pageMint;
    case 'rose': return PageTemplateColors.pageRose;
    case 'ink': return PageTemplateColors.pageInk;
    default: return PageTemplateColors.warmCream;
  }
}

export function textFor(appearance: PageAppearance): string {
  if (appearance.customBackground) return readableTextOn(appearance.customBackground);
  return appearance.template === 'ink' || appearance.template === 'night' || appearance.template === 'gradient' || appearance.background === 'ink'
    ? PageTemplateColors.pageLightText
    : PageTemplateColors.text1;
}

/** Inks that only appear on a dark ground — the signal for the mock's
 *  translucent `.t-grad` card treatment. A custom background resolves through
 *  `readableTextOn`, so `ON_DARK` has to count too. */
const LIGHT_INKS: readonly string[] = [PageTemplateColors.pageLightText, ON_DARK];

export function paletteFor(appearance: PageAppearance): PagePalette {
  const text = textFor(appearance);
  const onDark = LIGHT_INKS.includes(text);
  const cardRadius = TEMPLATE_CARD_RADIUS[appearance.template];
  if (onDark) {
    return {
      text,
      subtle: text,
      subtleOpacity: 0.72,
      cardBg: PageTemplateColors.pagePreviewGlass,
      cardBorder: PageTemplateColors.pagePreviewBorder,
      cardRadius,
      iconBg: PageTemplateColors.pagePreviewGlass,
      iconTint: text,
      placeholder: PageTemplateColors.pagePreviewGlass,
      onDark,
    };
  }
  return {
    text,
    subtle: PageTemplateColors.text2,
    subtleOpacity: 1,
    cardBg: PageTemplateColors.cardBg,
    cardBorder: PageTemplateColors.divider,
    cardRadius,
    iconBg: PageTemplateColors.searchBg,
    iconTint: PageTemplateColors.primaryBlue,
    placeholder: PageTemplateColors.warmCream,
    onDark,
  };
}

export function fontFor(font: PageAppearance['font']): string | undefined {
  switch (font) {
    case 'serif': return 'Georgia';
    case 'rounded': return 'Arial Rounded MT Bold';
    case 'mincho': return 'Hiragino Mincho ProN';
    case 'mono': return 'Courier';
    default: return undefined;
  }
}

/** `.link-card` / `.fe-card` / `.shop` share one bordered surface. */
export function previewCardStyle(palette: PagePalette, metrics: PreviewMetrics): ViewStyle {
  return {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: metrics.cardPadV,
    paddingHorizontal: metrics.cardPadH,
    borderWidth: 1,
    borderColor: palette.cardBorder,
    borderRadius: palette.cardRadius,
    backgroundColor: palette.cardBg,
  };
}

/** Items a block renders — `links` reads the record, every other block type
 *  carries its own signed items. */
export function blockItems(block: PageBlock, record: ProfileRecord): readonly PreviewItem[] {
  if (block.type !== 'links') return block.items;
  return record.links.map((link) => ({ id: link.url, title: link.label, url: link.url }));
}
