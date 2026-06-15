/**
 * UwbStatusPill — 1:1 port of Swift SharingTabView.uwbStatusPill.
 * Capsule with 6pt status dot + label + monospaced distance in cm.
 * Hidden by parent when UWB unsupported or inactive.
 */
import { Text, View } from 'react-native';

import { Colors } from '@/constants/Colors';

export type UwbSpatialState =
  | { kind: 'idle' }
  | { kind: 'approaching'; framesSeen: number; requiredFrames: number }
  | { kind: 'confirmed' }
  | { kind: 'exchanging' }
  | { kind: 'cooldown' };

export function UwbStatusPill({
  state,
  distanceMeters,
}: {
  state: UwbSpatialState;
  distanceMeters?: number;
}) {
  const color =
    state.kind === 'approaching'
      ? '#FF9500'
      : state.kind === 'confirmed' || state.kind === 'exchanging'
      ? Colors.terminalGreen
      : Colors.text3;
  const label = uwbLabel(state);
  return (
    <View
      className="flex-row items-center gap-1.5 self-center rounded-full bg-cardBg"
      style={{
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: `${color}66`,
      }}
    >
      <View
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }}
      />
      <Text className="text-text2 text-[12px] font-medium">{label}</Text>
      {typeof distanceMeters === 'number' ? (
        <Text
          style={{ fontFamily: 'Menlo' }}
          className="text-text3 text-[11px]"
        >
          {`${Math.round(distanceMeters * 100)} cm`}
        </Text>
      ) : null}
    </View>
  );
}

function uwbLabel(state: UwbSpatialState): string {
  switch (state.kind) {
    case 'approaching':
      return `Detecting (${state.framesSeen}/${state.requiredFrames})`;
    case 'confirmed': return 'Contact!';
    case 'exchanging': return 'Exchanging...';
    case 'cooldown': return 'Done';
    default: return 'UWB';
  }
}
