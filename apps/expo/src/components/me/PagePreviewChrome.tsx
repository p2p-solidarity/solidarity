/**
 * Header, empty notice, and footer of the Verified Page preview — the mock's
 * `.pub-avatar` / `.pub-name` / `.pub-handle` / `.pub-bio`, `.pub-empty`, and
 * `.pub-foot` (`creds-design/verified-linkinbio-mock-v3.html` §`#s-public`).
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed';
import { PageTemplateColors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { PageAppearance } from '@/page/pageDesign';
import { resolveProfileAvatarSource } from '@/profile/avatar';
import type { ProfileRecord } from '@solidarity/shared';

import type { PageLivePreviewVariant, PagePalette, PreviewMetrics } from './pagePreviewTheme';

export interface PagePreviewChromeProps {
  readonly palette: PagePalette;
  readonly metrics: PreviewMetrics;
  readonly fontFamily: string | undefined;
  readonly variant: PageLivePreviewVariant;
}

export function PagePreviewHeader({
  record,
  handle,
  palette,
  metrics,
  fontFamily,
  variant,
}: PagePreviewChromeProps & {
  readonly record: ProfileRecord;
  readonly handle: string | null;
}): ReactNode {
  const { t } = useTranslation();
  const avatarUrl = resolveProfileAvatarSource(record.avatar, null);
  const trimmedHandle = handle?.trim() ?? '';
  const headline = variant === 'public' ? 'headlineLarge' : 'headlineMedium';

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: metrics.avatar,
          height: metrics.avatar,
          borderRadius: metrics.avatar / 2,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 3,
          borderColor: palette.onDark ? PageTemplateColors.pagePreviewBorder : PageTemplateColors.cardBg,
          backgroundColor: palette.onDark ? PageTemplateColors.pagePreviewGlass : PageTemplateColors.warmCream,
        }}>
        <ThemedText
          variant={headline}
          style={{ color: palette.onDark ? palette.text : PageTemplateColors.primaryBlue, fontFamily }}>
          {(record.displayName.trim().charAt(0) || '?').toUpperCase()}
        </ThemedText>
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            contentFit="cover"
            accessibilityLabel={record.displayName}
            cachePolicy="memory-disk"
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />
        ) : null}
      </View>

      <ThemedText
        variant={headline}
        style={{
          color: palette.text,
          fontFamily,
          marginTop: metrics.headerGap,
          textAlign: 'center',
        }}>
        {record.displayName || t('mePage.unnamed')}
      </ThemedText>

      {trimmedHandle.length > 0 ? (
        <ThemedText
          variant="caption"
          numberOfLines={1}
          style={{
            color: palette.subtle,
            opacity: palette.subtleOpacity,
            fontFamily: 'Menlo',
            marginTop: 2,
            textAlign: 'center',
          }}>
          {trimmedHandle}
        </ThemedText>
      ) : null}

      {record.bio ? (
        <ThemedText
          variant="bodyMedium"
          style={{
            color: palette.text,
            fontFamily,
            marginTop: metrics.bioGap,
            textAlign: 'center',
          }}>
          {record.bio}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** `.pub-empty` — one quiet sentence. Deliberately no illustration and no
 *  call to action: an empty page is a normal state, not a failure. */
export function PagePreviewEmpty({ palette, metrics, fontFamily }: PagePreviewChromeProps): ReactNode {
  const { t } = useTranslation();
  return (
    <ThemedText
      variant="bodyMedium"
      style={{
        color: palette.subtle,
        opacity: palette.subtleOpacity,
        fontFamily,
        marginTop: metrics.sectionGap,
        textAlign: 'center',
      }}>
      {t('pageDesign.previewEmpty')}
    </ThemedText>
  );
}

/** `.pub-foot` — the brand line, far below the last card. */
export function PagePreviewFooter({
  appearance,
  palette,
  metrics,
  fontFamily,
}: PagePreviewChromeProps & { readonly appearance: PageAppearance }): ReactNode {
  if (!appearance.footerText && !appearance.showBrand) return null;
  return (
    <ThemedText
      variant="caption"
      style={{
        color: palette.subtle,
        opacity: palette.subtleOpacity,
        fontFamily: appearance.footerText ? fontFamily : 'Menlo',
        marginTop: metrics.footerGap,
        textAlign: 'center',
      }}>
      {appearance.footerText || 'creds.id'}
    </ThemedText>
  );
}

/** `.pf-title` — the block heading above every non-links section. */
export function PagePreviewSectionTitle({
  title,
  palette,
  fontFamily,
}: Omit<PagePreviewChromeProps, 'metrics' | 'variant'> & { readonly title: string }): ReactNode {
  return (
    <ThemedText
      variant="label"
      accessibilityRole="header"
      style={{
        color: palette.subtle,
        opacity: palette.subtleOpacity,
        fontFamily,
        letterSpacing: 0.5,
        marginBottom: 10,
      }}>
      {title}
    </ThemedText>
  );
}
