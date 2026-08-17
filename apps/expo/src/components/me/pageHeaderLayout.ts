export type PageHeaderLayout = 'inline' | 'stacked';

const MIN_INLINE_WIDTH = 390;
const MAX_INLINE_FONT_SCALE = 1.15;

/** Keep identity content usable when screen width or Dynamic Type is tight. */
export function pageHeaderLayout(width: number, fontScale: number): PageHeaderLayout {
  return width >= MIN_INLINE_WIDTH && fontScale <= MAX_INLINE_FONT_SCALE
    ? 'inline'
    : 'stacked';
}
