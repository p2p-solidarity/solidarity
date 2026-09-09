/**
 * T7 privacy-tier UI for the Me editor: the per-link `LinkVisibilityControl`
 * (Public / Link only / Private) and the `PublishPreviewSheet` shown before a
 * publish/save so the user sees EXACTLY what leaves the device. Split out of
 * `app/me/edit.tsx` to keep that screen focused; both are pure presentational
 * components driven by the editor's local state.
 */
import { Modal, View } from 'react-native';
import Animated, { Easing, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  LINK_VISIBILITIES,
  type LinkVisibility,
  type VisibilitySummary,
} from '@/profile/projection';

/** i18n keys per visibility tier — literal so the catalog test resolves them. */
const VISIBILITY_LABEL_KEYS: Record<LinkVisibility, string> = {
  public: 'meEdit.visibility.public',
  'link-only': 'meEdit.visibility.linkOnly',
  private: 'meEdit.visibility.private',
};
const VISIBILITY_HINT_KEYS: Record<LinkVisibility, string> = {
  public: 'meEdit.visibility.publicHint',
  'link-only': 'meEdit.visibility.linkOnlyHint',
  private: 'meEdit.visibility.privateHint',
};

/** Per-link privacy tier picker (T7): Public / Link only / Private. LOCAL only
 *  — the tier never enters the signed record, it only decides which projection
 *  a link appears in (public → Nostr, +link-only → QR, +private → your copy). */
export function LinkVisibilityControl({
  selected,
  onSelect,
}: {
  readonly selected: LinkVisibility;
  readonly onSelect: (visibility: LinkVisibility) => void;
}): React.ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 4 }}>
      <ThemedText variant="caption" tone="tertiary">
        {t('meEdit.visibility.label')}
      </ThemedText>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {LINK_VISIBILITIES.map((visibility) => {
          const active = selected === visibility;
          const label = t(VISIBILITY_LABEL_KEYS[visibility]);
          return (
            <PressableScale
              key={visibility}
              haptic="tap"
              onPress={() => {
                onSelect(visibility);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
              style={{ flex: 1 }}>
              <ThemedSurface
                variant="outlined"
                className="items-center justify-center rounded-none px-2"
                style={{
                  minHeight: 44,
                  borderColor: active ? Colors.primaryBlue : Colors.divider,
                  backgroundColor: active ? Colors.featuredCardBg : Colors.cardBg,
                }}>
                <ThemedText
                  variant="caption"
                  style={active ? { color: Colors.primaryBlue } : undefined}>
                  {label}
                </ThemedText>
              </ThemedSurface>
            </PressableScale>
          );
        })}
      </View>
      <ThemedText variant="caption" tone="tertiary">
        {t(VISIBILITY_HINT_KEYS[selected])}
      </ThemedText>
    </View>
  );
}

/** Pre-publish preview (T7 / grill G4): an honest, non-dismissible-by-accident
 *  summary of exactly what leaves this device before the user signs — how many
 *  links go PUBLIC (to Nostr), how many are shared by QR/link only, and how
 *  many stay private. Themed sheet, no native Alert. */
export function PublishPreviewSheet({
  visible,
  summary,
  publicLabels,
  willPublish,
  onConfirm,
  onClose,
}: {
  readonly visible: boolean;
  readonly summary: VisibilitySummary;
  readonly publicLabels: readonly string[];
  readonly willPublish: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayBg }}>
        <Animated.View
          entering={ZoomIn.duration(240)
            .easing(Easing.out(Easing.cubic))
            .withInitialValues({ opacity: 0, transform: [{ scale: 0.97 }] })}>
          <ThemedSurface
            variant="elevated"
            className="gap-4 rounded-t-2xl px-4 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
            <View className="gap-1">
              <ThemedText variant="titleLarge">{t('meEdit.preview.title')}</ThemedText>
              <ThemedText variant="bodySmall" tone="secondary">
                {t(willPublish ? 'meEdit.preview.subtitlePublish' : 'meEdit.preview.subtitleShare')}
              </ThemedText>
            </View>

            <ThemedSurface variant="inset" className="gap-2 rounded-none px-4 py-3">
              <ThemedText variant="bodyMedium">
                {summary.public === 0
                  ? t('meEdit.preview.nonePublic')
                  : t('meEdit.preview.publicCount', {
                      count: summary.public,
                      total: summary.total,
                    })}
              </ThemedText>
              {publicLabels.length > 0 ? (
                <ThemedText variant="caption" tone="secondary">
                  {publicLabels.join('  ·  ')}
                </ThemedText>
              ) : null}
              {summary.linkOnly > 0 ? (
                <ThemedText variant="caption" tone="tertiary">
                  {t('meEdit.preview.linkOnlyCount', { count: summary.linkOnly })}
                </ThemedText>
              ) : null}
              {summary.private > 0 ? (
                <ThemedText variant="caption" tone="tertiary">
                  {t('meEdit.preview.privateCount', { count: summary.private })}
                </ThemedText>
              ) : null}
            </ThemedSurface>

            <ThemedButton
              label={t(
                willPublish ? 'meEdit.preview.confirmPublish' : 'meEdit.preview.confirmSave'
              )}
              variant="primary"
              fullWidth
              haptic="success"
              onPress={onConfirm}
            />
            <ThemedButton
              label={t('meEdit.preview.cancel')}
              variant="secondary"
              fullWidth
              onPress={onClose}
            />
          </ThemedSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}
