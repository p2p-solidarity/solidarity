/**
 * InfoButton + InfoSheet — where an explanation goes when it is worth keeping
 * but not worth a paragraph on the screen. The screen shows state (an icon, a
 * badge, one short line); the "why" sits behind a quiet ⓘ that opens a sheet
 * with a title and one short paragraph.
 *
 * Use it instead of footers and multi-sentence subtitles. If the text is
 * needed to act correctly (a legal disclosure, an irreversible step), keep it
 * on screen instead — an ⓘ is for context, never for consent.
 */
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModalSheet } from '@/components/common/ModalSheet';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { SCALE } from '@/feedback/motion';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';

export interface InfoSheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly body: string;
  readonly onClose: () => void;
}

export function InfoSheet({ visible, title, body, onClose }: InfoSheetProps): ReactNode {
  return (
    <ModalSheet visible={visible} onRequestClose={onClose} presentationStyle="formSheet">
      <InfoSheetContent title={title} body={body} onClose={onClose} />
    </ModalSheet>
  );
}

function InfoSheetContent({
  title,
  body,
  onClose,
}: Omit<InfoSheetProps, 'visible'>): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg">
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          // iOS sheets report top 0; Android modals fill the window, so the
          // status bar inset has to be cleared here.
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}>
        <ThemedText variant="titleLarge" accessibilityRole="header">
          {title}
        </ThemedText>
        <ThemedText variant="bodyLarge" tone="secondary">
          {body}
        </ThemedText>
        <ThemedButton label={t('common.close')} variant="secondary" fullWidth onPress={onClose} />
      </ScrollView>
    </View>
  );
}

export interface InfoButtonProps {
  /** Sheet title; also the button's accessibility label. */
  readonly title: string;
  readonly body: string;
  readonly size?: number;
}

/** A quiet ⓘ that owns its sheet. 44pt hit area around a small glyph. */
export function InfoButton({ title, body, size = 16 }: InfoButtonProps): ReactNode {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PressableScale
        haptic="tap"
        scaleTo={SCALE.icon}
        onPress={() => {
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={title}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        style={{ alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name="info.circle" size={size} color={colors.text3} />
      </PressableScale>
      <InfoSheet
        visible={open}
        title={title}
        body={body}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
