import { stableJSON, type PublicPageDesign } from '@solidarity/shared';

export type PageBlockType =
  | 'links'
  | 'text'
  | 'portfolio'
  | 'featured'
  | 'video'
  | 'shop'
  | 'leave-card'
  | 'booking';

export type PageTemplateId =
  | 'cream'
  | 'ink'
  | 'journal'
  | 'gradient'
  | 'night'
  | 'mint'
  | 'sun'
  | 'minimal';

export type PageFontId = 'sans' | 'serif' | 'rounded' | 'mincho' | 'mono';
export type PageBackgroundId = 'cream' | 'white' | 'mint' | 'rose' | 'ink';

export interface PageBlockItem {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly media?: string;
  readonly price?: string;
}

export interface PageBlock {
  readonly id: string;
  readonly type: PageBlockType;
  readonly title: string;
  readonly items: readonly PageBlockItem[];
  readonly style: string;
  readonly visible: boolean;
  readonly order: number;
}

export interface PageAppearance {
  readonly template: PageTemplateId;
  readonly font: PageFontId;
  readonly background: PageBackgroundId;
  readonly customBackground: string | null;
  readonly showBrand: boolean;
  readonly footerText: string;
}

export interface LapsedAlertPersistence {
  readonly currentSignature: string | null;
  readonly dismissedSignature: string | null;
}

export interface PageDesign {
  readonly version: 1;
  readonly blocks: readonly PageBlock[];
  readonly appearance: PageAppearance;
  readonly lapsedAlert: LapsedAlertPersistence;
}

export interface PageBlockCatalogEntry {
  readonly type: PageBlockType;
  readonly defaultTitle: string;
  readonly defaultStyle: string;
  readonly styles: readonly string[];
  readonly pro: boolean;
}

export const PAGE_BLOCK_CATALOG: readonly PageBlockCatalogEntry[] = [
  { type: 'links', defaultTitle: 'Links', defaultStyle: 'list', styles: ['list'], pro: false },
  { type: 'text', defaultTitle: 'Text', defaultStyle: 'plain', styles: ['plain', 'card'], pro: false },
  {
    type: 'portfolio',
    defaultTitle: 'Portfolio',
    defaultStyle: 'grid',
    styles: ['grid', 'list', 'carousel'],
    pro: false,
  },
  {
    type: 'featured',
    defaultTitle: 'Featured',
    defaultStyle: 'large-card',
    styles: ['large-card', 'list'],
    pro: false,
  },
  {
    type: 'video',
    defaultTitle: 'Video',
    defaultStyle: 'embed',
    styles: ['embed', 'thumbnail'],
    pro: false,
  },
  { type: 'shop', defaultTitle: 'Shop', defaultStyle: 'list', styles: ['list', 'grid'], pro: true },
  {
    type: 'leave-card',
    defaultTitle: 'Leave a Card',
    defaultStyle: 'card',
    styles: ['card', 'button'],
    pro: true,
  },
  {
    type: 'booking',
    defaultTitle: 'Booking',
    defaultStyle: 'slots',
    styles: ['slots', 'button'],
    pro: true,
  },
] as const;

export const PAGE_TEMPLATE_IDS: readonly PageTemplateId[] = [
  'cream',
  'ink',
  'journal',
  'gradient',
  'night',
  'mint',
  'sun',
  'minimal',
] as const;

export const PAGE_FONT_IDS: readonly PageFontId[] = ['sans', 'serif', 'rounded', 'mincho', 'mono'];
export const PAGE_BACKGROUND_IDS: readonly PageBackgroundId[] = ['cream', 'white', 'mint', 'rose', 'ink'];
/** Keep the editable draft within the signed Page schema's QR-safe bounds. */
export const MAX_PAGE_BLOCK_COUNT = 16;
export const MAX_PAGE_ITEMS_PER_BLOCK = 24;
export const MAX_PAGE_BLOCK_TITLE_LENGTH = 120;
export const MAX_PAGE_ITEM_TITLE_LENGTH = 160;
export const MAX_PAGE_ITEM_PRICE_LENGTH = 64;

const INITIAL_APPEARANCE: PageAppearance = {
  template: 'cream',
  font: 'sans',
  background: 'cream',
  customBackground: null,
  showBrand: true,
  footerText: '',
};

const INITIAL_LAPSED_ALERT: LapsedAlertPersistence = {
  currentSignature: null,
  dismissedSignature: null,
};

export function createInitialPageDesign(): PageDesign {
  return {
    version: 1,
    blocks: [createBlock('links', 'links')],
    appearance: INITIAL_APPEARANCE,
    lapsedAlert: INITIAL_LAPSED_ALERT,
  };
}

/**
 * Strip device-only editor state before a Page joins the signed profile
 * payload. The resulting value is schema-checked by `saveProfile` before a
 * signer is ever requested, so a malformed local draft cannot become a QR.
 */
export function toPublicPageDesign(design: PageDesign): PublicPageDesign {
  return {
    blocks: design.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      items: block.items.map((item) => ({
        id: item.id,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
        ...(item.media ? { media: item.media } : {}),
        ...(item.price ? { price: item.price } : {}),
      })),
      style: block.style,
      visible: block.visible,
      order: block.order,
    })),
    appearance: {
      template: design.appearance.template,
      font: design.appearance.font,
      background: design.appearance.background,
      customBackground: design.appearance.customBackground,
      showBrand: design.appearance.showBrand,
      footerText: design.appearance.footerText,
    },
  };
}

/** Rehydrate a signed public Page into the local editor without importing
 * transient alert dismissal state from another device or publication. */
export function pageDesignFromPublicPage(page: PublicPageDesign): PageDesign {
  return {
    version: 1,
    blocks: page.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      items: block.items.map((item) => ({
        id: item.id,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
        ...(item.media ? { media: item.media } : {}),
        ...(item.price ? { price: item.price } : {}),
      })),
      style: block.style,
      visible: block.visible,
      order: block.order,
    })),
    appearance: {
      template: page.appearance.template,
      font: page.appearance.font,
      background: page.appearance.background,
      customBackground: page.appearance.customBackground,
      showBrand: page.appearance.showBrand,
      footerText: page.appearance.footerText,
    },
    lapsedAlert: INITIAL_LAPSED_ALERT,
  };
}

/** Canonical equality for the signed portion only — lapsed-check dismissal
 * is local UI state and must never mark a Page as needing publication. */
export function publicPageDesignEquals(
  left: PublicPageDesign,
  right: PublicPageDesign
): boolean {
  return stableJSON(left) === stableJSON(right);
}

function catalogEntry(type: PageBlockType): PageBlockCatalogEntry {
  const entry = PAGE_BLOCK_CATALOG.find((candidate) => candidate.type === type);
  if (!entry) throw new Error(`Unsupported Page block type: ${type}`);
  return entry;
}

function createBlock(type: PageBlockType, id: string, title?: string): PageBlock {
  const entry = catalogEntry(type);
  const cleanTitle = title?.trim();
  return {
    id,
    type,
    title: cleanTitle && cleanTitle.length > 0 ? cleanTitle : entry.defaultTitle,
    items: [],
    style: entry.defaultStyle,
    visible: true,
    order: type === 'links' ? 0 : 1,
  };
}

function withCanonicalOrder(blocks: readonly PageBlock[]): readonly PageBlock[] {
  const links = blocks.find((block) => block.type === 'links') ?? createBlock('links', 'links');
  const movable = blocks
    .filter((block) => block.type !== 'links')
    .map((block, index) => ({ ...block, order: index + 1 }));
  return [{ ...links, id: 'links', visible: true, order: 0 }, ...movable];
}

export function addPageBlock(
  design: PageDesign,
  type: Exclude<PageBlockType, 'links'>,
  id: string,
  title?: string
): PageDesign {
  if (design.blocks.length >= MAX_PAGE_BLOCK_COUNT) return design;
  return {
    ...design,
    blocks: withCanonicalOrder([...design.blocks, createBlock(type, id, title)]),
  };
}

export function updatePageBlock(
  design: PageDesign,
  id: string,
  patch: Partial<Pick<PageBlock, 'title' | 'items' | 'style'>>
): PageDesign {
  const target = design.blocks.find((block) => block.id === id);
  if (!target || target.type === 'links') return design;
  const entry = catalogEntry(target.type);
  const title = patch.title?.trim().slice(0, MAX_PAGE_BLOCK_TITLE_LENGTH);
  const style = patch.style && entry.styles.includes(patch.style) ? patch.style : target.style;
  const items = patch.items?.slice(0, MAX_PAGE_ITEMS_PER_BLOCK).map((item) => ({
    ...item,
    id: item.id.slice(0, 64),
    title: item.title.slice(0, MAX_PAGE_ITEM_TITLE_LENGTH),
    ...(item.price !== undefined ? { price: item.price.slice(0, MAX_PAGE_ITEM_PRICE_LENGTH) } : {}),
  }));
  return {
    ...design,
    blocks: design.blocks.map((block) =>
      block.id === id
        ? {
            ...block,
            title: title && title.length > 0 ? title : block.title,
            items: items ?? block.items,
            style,
          }
        : block
    ),
  };
}

export function togglePageBlock(design: PageDesign, id: string, visible: boolean): PageDesign {
  const target = design.blocks.find((block) => block.id === id);
  if (!target || target.type === 'links' || target.visible === visible) return design;
  return {
    ...design,
    blocks: design.blocks.map((block) => block.id === id ? { ...block, visible } : block),
  };
}

export function movePageBlock(
  design: PageDesign,
  id: string,
  direction: 'up' | 'down'
): PageDesign {
  const movable = design.blocks.filter((block) => block.type !== 'links');
  const index = movable.findIndex((block) => block.id === id);
  if (index < 0) return design;
  const destination = direction === 'up' ? index - 1 : index + 1;
  if (destination < 0 || destination >= movable.length) return design;
  const reordered = [...movable];
  const [block] = reordered.splice(index, 1);
  if (!block) return design;
  reordered.splice(destination, 0, block);
  const links = design.blocks.find((candidate) => candidate.type === 'links');
  if (!links) return design;
  return { ...design, blocks: withCanonicalOrder([links, ...reordered]) };
}

export function removePageBlock(design: PageDesign, id: string): PageDesign {
  const target = design.blocks.find((block) => block.id === id);
  if (!target || target.type === 'links') return design;
  return { ...design, blocks: withCanonicalOrder(design.blocks.filter((block) => block.id !== id)) };
}

export interface LapsedEvidence {
  readonly id: string;
  readonly label: string;
}

export interface LapsedAlertModel extends LapsedAlertPersistence {
  readonly evidence: readonly LapsedEvidence[];
  readonly visible: boolean;
}

function evidenceSignature(evidence: readonly LapsedEvidence[]): string | null {
  if (evidence.length === 0) return null;
  return [...new Set(evidence.map(({ id }) => id))].sort().join('|');
}

export function syncLapsedAlert(
  persisted: LapsedAlertPersistence,
  evidence: readonly LapsedEvidence[]
): LapsedAlertModel {
  const signature = evidenceSignature(evidence);
  const stateChanged = signature !== persisted.currentSignature;
  const dismissedSignature = stateChanged ? null : persisted.dismissedSignature;
  return {
    currentSignature: signature,
    dismissedSignature,
    evidence,
    visible: signature !== null && signature !== dismissedSignature,
  };
}

export function dismissLapsedAlert(model: LapsedAlertModel): LapsedAlertModel {
  return {
    ...model,
    dismissedSignature: model.currentSignature,
    visible: false,
  };
}

type NormalizeResult =
  | { readonly ok: true; readonly value: PageDesign }
  | { readonly ok: false; readonly error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockType(value: unknown): value is PageBlockType {
  return PAGE_BLOCK_CATALOG.some((entry) => entry.type === value);
}

function isBlockItem(value: unknown): value is PageBlockItem {
  if (!isObject(value) || typeof value['id'] !== 'string' || typeof value['title'] !== 'string') return false;
  return ['url', 'media', 'price'].every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function readBlock(value: unknown): PageBlock | null {
  if (!isObject(value) || typeof value['id'] !== 'string' || !isBlockType(value['type'])) return null;
  if (
    typeof value['title'] !== 'string' ||
    !Array.isArray(value['items']) ||
    !value['items'].every(isBlockItem) ||
    typeof value['style'] !== 'string' ||
    !catalogEntry(value['type']).styles.includes(value['style']) ||
    typeof value['visible'] !== 'boolean' ||
    typeof value['order'] !== 'number'
  ) return null;
  return value as unknown as PageBlock;
}

function readAppearance(value: unknown): PageAppearance | null {
  if (!isObject(value)) return null;
  if (
    !PAGE_TEMPLATE_IDS.includes(value['template'] as PageTemplateId) ||
    !PAGE_FONT_IDS.includes(value['font'] as PageFontId) ||
    !PAGE_BACKGROUND_IDS.includes(value['background'] as PageBackgroundId) ||
    !(value['customBackground'] === null || typeof value['customBackground'] === 'string') ||
    typeof value['showBrand'] !== 'boolean' ||
    typeof value['footerText'] !== 'string'
  ) return null;
  return value as unknown as PageAppearance;
}

function readLapsedAlert(value: unknown): LapsedAlertPersistence | null {
  if (!isObject(value)) return null;
  const current = value['currentSignature'];
  const dismissed = value['dismissedSignature'];
  if (!(current === null || typeof current === 'string')) return null;
  if (!(dismissed === null || typeof dismissed === 'string')) return null;
  return { currentSignature: current, dismissedSignature: dismissed };
}

export function normalizePageDesign(value: unknown): NormalizeResult {
  if (!isObject(value) || !Array.isArray(value['blocks'])) {
    return { ok: false, error: 'Page design is malformed.' };
  }
  const blocks = value['blocks'].map(readBlock);
  if (blocks.some((block) => block === null)) return { ok: false, error: 'Page design is malformed.' };
  const typedBlocks = blocks as PageBlock[];
  const uniqueIds = new Set(typedBlocks.map((block) => block.id));
  const linksCount = typedBlocks.filter((block) => block.type === 'links').length;
  if (
    uniqueIds.size !== typedBlocks.length ||
    linksCount !== 1
  ) return { ok: false, error: 'Page design is malformed.' };

  const appearance = readAppearance(value['appearance']);
  const lapsedAlert = readLapsedAlert(value['lapsedAlert']);
  if (!appearance || !lapsedAlert) return { ok: false, error: 'Page design is malformed.' };

  return {
    ok: true,
    value: {
      version: 1,
      blocks: withCanonicalOrder([...typedBlocks].sort((a, b) => a.order - b.order)),
      appearance,
      lapsedAlert,
    },
  };
}
