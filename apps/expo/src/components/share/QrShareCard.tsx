/**
 * QrShareCard — Share-tab QR card. Structure follows Figma `scan/show code`
 * (726:23611): a card-info HEADER on top, the collapsible QR in the middle,
 * and the Show/Hide-code + share buttons at the bottom.
 *
 *   1. Header (always visible): 48pt avatar + name + optional "Real human"
 *      badge + FieldPillRow + chevron.right → ShareSettings (whole row taps).
 *   2. Collapsible QR area (white quiet-zone, square aspect). Empty state:
 *      `qrcode` icon + "Create a card to generate QR".
 *   3. Buttons row: full-width "Hide code"/"Show code" ThemedButton (primary)
 *      + 50×46 outlined share icon button.
 *
 * Behaviour mirrors Swift `SharingTabView+Sections.qrSection` (the QR is
 * collapsible via `isQRExpanded`); the Figma stacks the header above the QR.
 */
import { useState } from 'react';
import { type LayoutChangeEvent, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  type EnabledField,
  FieldPillRow,
} from '@/components/share/FieldPillRow';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';

/**
 * White quiet-zone between the QR modules and the card frame. The QR is sized
 * to the measured square minus this margin so it hugs the frame instead of
 * floating in the middle of an oversized white box.
 */
const QR_FRAME_PADDING = 16;

export interface QrShareCardProps {
  /** QR payload to encode. `undefined` → placeholder state. */
  payload?: string;
  cardName?: string;
  enabledFields: readonly EnabledField[];
  hasRealHuman?: boolean;
  onOpenSettings: () => void;
  onShare: () => void;
}

export function QrShareCard({
  payload,
  cardName,
  enabledFields,
  hasRealHuman = false,
  onOpenSettings,
  onShare,
}: QrShareCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  // Measured edge of the square white QR area, so the code can be sized to
  // fill it (minus the quiet-zone) on any device width.
  const [qrBox, setQrBox] = useState(0);
  const onQrLayout = (e: LayoutChangeEvent) => {
    setQrBox(e.nativeEvent.layout.width);
  };

  return (
    <View
      className="overflow-hidden rounded-xl bg-featuredCardBg"
      style={{
        borderWidth: 1,
        borderColor: `${Colors.divider}80`,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      }}
    >
      <View className="p-4 gap-4">
        <PressableScale
          haptic="tap"
          onPress={onOpenSettings}
          accessibilityRole="button"
          className="flex-row items-center"
          style={{ gap: 16 }}
        >
          <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
            <View
              className="overflow-hidden rounded-full bg-searchBg"
              style={{ width: 48, height: 48, borderWidth: 1, borderColor: Colors.divider }}
            >
              <View
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <SfIcon name="person" size={20} color={Colors.text3} />
              </View>
            </View>
            <View className="flex-1" style={{ gap: 8 }}>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <Text
                  className="text-text1 text-[20px] font-medium capitalize"
                  numberOfLines={1}
                >
                  {cardName ?? t('qrShareCard.noCard')}
                </Text>
                {hasRealHuman ? <RealHumanBadge label={t('qrShareCard.realHuman')} /> : null}
              </View>
              <FieldPillRow fields={enabledFields} />
            </View>
          </View>
          <SfIcon
            name="chevron.right"
            size={14}
            weight="semibold"
            color={Colors.text3}
          />
        </PressableScale>

        {expanded ? (
          <View
            onLayout={onQrLayout}
            style={{
              backgroundColor: '#FFFFFF',
              aspectRatio: 1,
              borderRadius: 2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {payload ? (
              qrBox > 0 ? (
                <QRCode
                  value={payload}
                  size={qrBox - QR_FRAME_PADDING * 2}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                />
              ) : null
            ) : (
              <View className="items-center gap-2.5">
                <SfIcon name="qrcode" size={44} color="#C7C7C7" />
                <Text style={{ fontFamily: 'Menlo' }} className="text-[12px]">
                  {t('qrShareCard.createCard')}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <View className="flex-row items-center" style={{ gap: 16 }}>
          <View className="flex-1">
            <ThemedButton
              fullWidth
              variant="primary"
              size="md"
              haptic="tap"
              label={expanded ? t('qrShareCard.hideCode') : t('qrShareCard.showCode')}
              onPress={() => { setExpanded(!expanded); }}
            />
          </View>
          {/* Outlined icon-only share button (Figma 726:24426): transparent
              fill + text3 border so it stays visible on the cream card on
              both platforms. Icon-only → custom press target, not ThemedButton. */}
          <PressableScale
            haptic="tap"
            scaleTo={SCALE.icon}
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel={t('qrShareCard.share')}
            style={{
              width: 50,
              height: 46,
              borderWidth: 1,
              borderColor: Colors.text3,
              borderRadius: 2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SfIcon name="square.and.arrow.up" size={18} color={Colors.text1} />
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

function RealHumanBadge({ label }: { readonly label: string }) {
  return (
    <View
      className="flex-row items-center gap-1 rounded-sm"
      style={{
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderWidth: 1,
        borderColor: Colors.pillBorder,
      }}
    >
      <SfIcon
        name="checkmark.seal.fill"
        size={12}
        color={Colors.terminalGreen}
      />
      <Text className="text-text2 text-[10px]">{label}</Text>
    </View>
  );
}
