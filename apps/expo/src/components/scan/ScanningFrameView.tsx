/**
 * ScanningFrameView — 1:1 port of Swift ScanComponents.swift.
 * 250×250 white rounded square with 30pt green corner indicators in
 * the 4 corners. Centred over the camera preview.
 */
import { View } from 'react-native';

import { Colors } from '@/constants/Colors';

const FRAME = 250;
const CORNER = 30;

export function ScanningFrameView() {
  return (
    <View
      style={{
        width: FRAME,
        height: FRAME,
        borderRadius: 20,
        borderWidth: 3,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ position: 'absolute', top: 0, left: 0 }}>
        <CornerIndicator corner="topLeft" />
      </View>
      <View style={{ position: 'absolute', top: 0, right: 0 }}>
        <CornerIndicator corner="topRight" />
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0 }}>
        <CornerIndicator corner="bottomLeft" />
      </View>
      <View style={{ position: 'absolute', bottom: 0, right: 0 }}>
        <CornerIndicator corner="bottomRight" />
      </View>
    </View>
  );
}

function CornerIndicator({
  corner,
}: {
  corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}) {
  // Each indicator is a 30×30 square with one corner rounded to 8.
  const radii =
    corner === 'topLeft'
      ? { borderTopLeftRadius: 8 }
      : corner === 'topRight'
      ? { borderTopRightRadius: 8 }
      : corner === 'bottomLeft'
      ? { borderBottomLeftRadius: 8 }
      : { borderBottomRightRadius: 8 };
  return (
    <View
      style={{
        width: CORNER,
        height: CORNER,
        backgroundColor: Colors.terminalGreen,
        ...radii,
      }}
    />
  );
}
