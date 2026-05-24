/**
 * PresentationChunkPlaybackControls — port of
 * solidarity/Views/MeViews/PresentationChunkPlaybackControls.swift.
 *
 * Shown beneath the chunked QR when a presentation payload needs more than
 * one frame. Caller owns the auto-advance timer + chunk index; this view is
 * pure UI. Used inside the same parent that owns `buildPresentationQrPages`
 * output (see `src/me/presentationQrPages.ts`).
 */
import { Pressable, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

export interface PresentationChunkPlaybackControlsProps {
  readonly currentIndex: number;
  readonly totalChunks: number;
  readonly isPlaying: boolean;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onTogglePlay: () => void;
}

const HIT_SIZE = 44;

export function PresentationChunkPlaybackControls({
  currentIndex,
  totalChunks,
  isPlaying,
  onPrev,
  onNext,
  onTogglePlay,
}: PresentationChunkPlaybackControlsProps) {
  const atFirst = currentIndex <= 0;
  const atLast = currentIndex >= totalChunks - 1;
  const progress =
    totalChunks > 0 ? Math.min(1, (currentIndex + 1) / totalChunks) : 0;

  return (
    <View style={{ paddingHorizontal: 20, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ThemedText variant="caption" tone="secondary">
          {`Chunk ${currentIndex + 1} of ${totalChunks}`}
        </ThemedText>
        <View style={{ flex: 1 }} />
        <ThemedText
          variant="caption"
          style={{ color: Colors.terminalGreen }}
        >
          Offline transfer
        </ThemedText>
      </View>

      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: Colors.divider,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            backgroundColor: Colors.terminalGreen,
          }}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <ChunkControlButton
          symbol="chevron.left"
          accessibilityLabel="Previous chunk"
          disabled={atFirst}
          onPress={() => {
            haptic('tap');
            onPrev();
          }}
        />
        <ChunkControlButton
          symbol={isPlaying ? 'pause.fill' : 'play.fill'}
          accessibilityLabel={isPlaying ? 'Pause chunks' : 'Resume chunks'}
          onPress={() => {
            haptic('tap');
            onTogglePlay();
          }}
        />
        <ChunkControlButton
          symbol="chevron.right"
          accessibilityLabel="Next chunk"
          disabled={atLast}
          onPress={() => {
            haptic('tap');
            onNext();
          }}
        />
      </View>

      <ThemedText
        variant="caption"
        tone="secondary"
        style={{ textAlign: 'center' }}
      >
        The verifier can scan these frames in any order.
      </ThemedText>
    </View>
  );
}

interface ChunkControlButtonProps {
  readonly symbol: 'chevron.left' | 'chevron.right' | 'play.fill' | 'pause.fill';
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}

function ChunkControlButton({
  symbol,
  accessibilityLabel,
  onPress,
  disabled = false,
}: ChunkControlButtonProps) {
  const tint = disabled ? Colors.text3 : Colors.terminalGreen;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: HIT_SIZE,
        height: HIT_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: disabled ? Colors.divider : Colors.terminalGreen,
        opacity: pressed && !disabled ? 0.6 : 1,
      })}
    >
      <SfIcon name={symbol} size={17} weight="semibold" color={tint} />
    </Pressable>
  );
}
