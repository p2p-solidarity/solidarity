/**
 * QrShareCard — 1:1 port of Swift SharingTabView.qrSection.
 *
 * Two stacked layers inside a 12pt-radius rounded card:
 *   1. Collapsible QR area (white background, square aspect). Empty state:
 *      `qrcode` icon + "Create a card to generate QR".
 *   2. Footer (featuredCardBg): row with 32pt avatar + name + optional
 *      Real Human badge + chevron.right → ShareSettings; then FieldPillRow;
 *      then row with full-width "Hide code"/"Show code" inverted button
 *      + 50×46 share icon button (warmCream + pillBorder).
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
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';

/**
 * White quiet-zone between the QR modules and the card frame. The QR is sized
 * to the measured square minus this margin so it hugs the frame instead of
 * floating in the middle of an oversized white box (the previous fixed 240pt
 * QR + 24pt pad left a wide gutter on most devices).
 */
const QR_FRAME_PADDING = 16;

export type QrShareCardProps = {
  /** QR payload to encode. `undefined` → placeholder state. */
  payload?: string;
  cardName?: string;
  enabledFields: readonly EnabledField[];
  hasRealHuman?: boolean;
  onOpenSettings: () => void;
  onShare: () => void;
};

export function QrShareCard({
  payload,
  cardName,
  enabledFields,
  hasRealHuman = false,
  onOpenSettings,
  onShare,
}: QrShareCardProps) {
  const [expanded, setExpanded] = useState(true);
  // Measured edge of the square white QR area, so the code can be sized to
  // fill it (minus the quiet-zone) on any device width.
  const [qrBox, setQrBox] = useState(0);
  const onQrLayout = (e: LayoutChangeEvent) => {
    setQrBox(e.nativeEvent.layout.width);
  };

  return (
    <View
      className="overflow-hidden rounded-xl"
      style={{
        borderWidth: 1,
        borderColor: `${Colors.divider}80`,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      }}
    >
      {expanded ? (
        <View
          onLayout={onQrLayout}
          style={{
            backgroundColor: '#FFFFFF',
            aspectRatio: 1,
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
              <Text
                style={{ fontFamily: 'Menlo' }}
                className="text-[12px]"
              >
                Create a card to generate QR
              </Text>
            </View>
          )}
        </View>
      ) : null}

      <View className="p-4 bg-featuredCardBg gap-3">
        <PressableScale
          haptic="tap"
          onPress={onOpenSettings}
          accessibilityRole="button"
          className="flex-row items-center gap-2.5"
        >
          <View
            className="overflow-hidden rounded-full bg-searchBg"
            style={{ width: 32, height: 32, borderWidth: 1, borderColor: Colors.divider }}
          >
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SfIcon name="person" size={14} color={Colors.text3} />
            </View>
          </View>
          <Text className="text-text1 text-[17px] font-semibold flex-1" numberOfLines={1}>
            {cardName ?? 'No Card'}
          </Text>
          {hasRealHuman ? <RealHumanBadge /> : null}
          <SfIcon
            name="chevron.right"
            size={14}
            weight="semibold"
            color={Colors.text3}
          />
        </PressableScale>

        <FieldPillRow fields={enabledFields} />

        <View className="flex-row items-center gap-2.5">
          <PressableScale
            fill
            haptic="tap"
            onPress={() => setExpanded(!expanded)}
            accessibilityRole="button"
            className="rounded-lg"
            style={{
              paddingVertical: 14,
              backgroundColor: Colors.text1,
              alignItems: 'center',
            }}
          >
            <Text
              style={{ color: Colors.pageBg }}
              className="text-[15px] font-semibold"
            >
              {expanded ? 'Hide code' : 'Show code'}
            </Text>
          </PressableScale>
          {/* Solid ink fill + real share glyph (`square.and.arrow.up` →
              Material `ios_share`): the old warmCream-on-cream button was
              effectively invisible on Android. */}
          <PressableScale
            haptic="tap"
            scaleTo={SCALE.icon}
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share"
            className="rounded-lg"
            style={{
              width: 50,
              height: 46,
              backgroundColor: Colors.text1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SfIcon
              name="square.and.arrow.up"
              size={18}
              color={Colors.pageBg}
            />
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

function RealHumanBadge() {
  return (
    <View
      className="flex-row items-center gap-1 rounded bg-pillBg"
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: 1,
        borderColor: Colors.pillBorder,
      }}
    >
      <SfIcon
        name="checkmark.seal.fill"
        size={12}
        color={Colors.terminalGreen}
      />
      <Text className="text-text2 text-[12px] font-medium">Real human</Text>
    </View>
  );
}
