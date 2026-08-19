import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated, {
  SensorType,
  clamp,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { CardMetalColors, Colors } from '@/constants/Colors';

/** `.metal` — credit-card proportions and the mock's 18pt corner. */
const CARD_ASPECT_RATIO = 1.586;
const CARD_RADIUS = 18;
/** `.m-qr` — 70pt plate, 5pt inset around the code. */
const CARD_QR_SIZE = 70;
const CARD_QR_PADDING = 5;

export type CardQrState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly uri: string }
  | { readonly kind: 'error' };

function CardQr({ state }: { readonly state: CardQrState }): ReactNode {
  let content: ReactNode;
  if (state.kind === 'ready') {
    content = (
      <Image
        source={{ uri: state.uri }}
        contentFit="contain"
        style={{ width: CARD_QR_SIZE - CARD_QR_PADDING * 2, height: CARD_QR_SIZE - CARD_QR_PADDING * 2 }}
      />
    );
  } else if (state.kind === 'loading') {
    content = <ActivityIndicator size="small" color={Colors.primaryMauve} />;
  } else {
    content = <SfIcon name="exclamationmark.triangle" size={20} color={Colors.destructive} />;
  }

  return (
    <View
      style={{
        width: CARD_QR_SIZE,
        height: CARD_QR_SIZE,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: CardMetalColors.qrPlate,
        padding: CARD_QR_PADDING,
      }}>
      {content}
    </View>
  );
}

/** `.etch` — engraved lettering: pale steel type with a shadow under it. */
const ETCH_TEXT = {
  color: CardMetalColors.etch,
  textShadowColor: CardMetalColors.etchShadow,
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 0,
} as const;

function CardSheen({ enabled }: { readonly enabled: boolean }): ReactNode {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(-1);

  useEffect(() => {
    progress.value = -1;
    if (!enabled || reduceMotion) return;
    progress.value = withDelay(260, withTiming(1, { duration: 900 }));
  }, [enabled, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 330 }, { rotate: '18deg' }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: -90,
          left: 0,
          width: 92,
          height: 410,
          opacity: enabled ? 0.48 : 0.24,
        },
        style,
      ]}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.72)', 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

function useCardMotion(isFlipped: boolean) {
  const reduceMotion = useReducedMotion();
  const rotation = useAnimatedSensor(SensorType.ROTATION, {
    interval: 80,
    adjustToInterfaceOrientation: true,
  });
  const flip = useSharedValue(0);

  useEffect(() => {
    flip.value = reduceMotion
      ? isFlipped ? 180 : 0
      : withSpring(isFlipped ? 180 : 0, { damping: 18, stiffness: 150 });
  }, [flip, isFlipped, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) rotation.unregister();
  }, [reduceMotion, rotation]);

  const tiltStyle = useAnimatedStyle(() => {
    const pitch = reduceMotion || !rotation.isAvailable
      ? 0
      : clamp(rotation.sensor.value.pitch * 8, -6, 6);
    const roll = reduceMotion || !rotation.isAvailable
      ? 0
      : clamp(rotation.sensor.value.roll * 8, -7, 7);
    return {
      transform: [
        { perspective: 900 },
        { rotateX: `${String(-pitch)}deg` },
        { rotateY: `${String(roll)}deg` },
      ],
    };
  });
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${String(flip.value)}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${String(flip.value + 180)}deg` }],
  }));

  return { tiltStyle, frontStyle, backStyle };
}

interface PresentCardVisualProps {
  readonly resolvedAccent: string;
  readonly enableGlow: boolean;
  readonly name: string | null;
  /** Printed under the name in mono — the page address this card hands over. */
  readonly displayUrl: string;
  /** What the QR carries this time, e.g. "name + 2 fields". */
  readonly summary: string;
  readonly scanHint: string;
  readonly qrState: CardQrState;
  readonly flipLabel: string;
}

export function PresentCardVisual(props: PresentCardVisualProps): ReactNode {
  const [isFlipped, setIsFlipped] = useState(false);
  const { tiltStyle, frontStyle, backStyle } = useCardMotion(isFlipped);
  const faceStyle = {
    position: 'absolute' as const,
    inset: 0,
    overflow: 'hidden' as const,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: CardMetalColors.faceBorder,
    backfaceVisibility: 'hidden' as const,
  };
  const toggleFlip = () => {
    setIsFlipped((value) => !value);
  };

  return (
    <View style={{ gap: 12 }}>
      <Animated.View style={tiltStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.flipLabel}
          accessibilityState={{ expanded: isFlipped }}
          onPress={toggleFlip}
          style={{
            aspectRatio: CARD_ASPECT_RATIO,
            borderRadius: CARD_RADIUS,
            shadowColor: props.enableGlow ? props.resolvedAccent : Colors.text1,
            shadowOpacity: props.enableGlow ? 0.34 : 0.22,
            shadowRadius: props.enableGlow ? 24 : 22,
            shadowOffset: { width: 0, height: 12 },
            elevation: 8,
          }}>
          <Animated.View style={[faceStyle, frontStyle]}>
            <LinearGradient
              colors={CardMetalColors.frontStops}
              locations={CardMetalColors.frontLocations}
              start={{ x: 0, y: 0.39 }}
              end={{ x: 1, y: 0.61 }}
              style={{ flex: 1, paddingVertical: 15, paddingHorizontal: 16 }}>
              <CardSheen enabled={props.enableGlow} />
              {/* `.m-nfc` — the tap-to-exchange mark, quiet in the corner. */}
              <View style={{ position: 'absolute', top: 14, right: 15, opacity: 0.55 }}>
                <SfIcon name="wave.3.right" size={16} color={CardMetalColors.etch} />
              </View>
              {props.name !== null ? (
                <ThemedText variant="titleLarge" numberOfLines={1} style={ETCH_TEXT}>
                  {props.name}
                </ThemedText>
              ) : null}
              <ThemedText
                variant="caption"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ ...ETCH_TEXT, fontFamily: 'Menlo', opacity: 0.82, marginTop: 1 }}>
                {props.displayUrl}
              </ThemedText>
              {/* `.m-row` — pinned to the bottom edge of the card. */}
              <View
                className="flex-row items-end"
                style={{ gap: 12, marginTop: 'auto' }}>
                <CardQr state={props.qrState} />
                <View className="min-w-0 flex-1">
                  <ThemedText variant="bodySmall" numberOfLines={1} style={ETCH_TEXT}>
                    {props.summary}
                  </ThemedText>
                  <ThemedText
                    variant="caption"
                    numberOfLines={1}
                    style={{ ...ETCH_TEXT, opacity: 0.72, marginTop: 2 }}>
                    {props.scanHint}
                  </ThemedText>
                </View>
              </View>
            </LinearGradient>
          </Animated.View>
          <Animated.View style={[faceStyle, backStyle]}>
            <LinearGradient
              colors={CardMetalColors.backStops}
              locations={CardMetalColors.backLocations}
              start={{ x: 1, y: 0.61 }}
              end={{ x: 0, y: 0.39 }}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: 18,
              }}>
              <CardSheen enabled={props.enableGlow} />
              <ThemedText variant="caption" style={{ ...ETCH_TEXT, fontFamily: 'Menlo', letterSpacing: 2.2 }}>
                CREDS.ID
              </ThemedText>
              <View style={{ opacity: 0.6 }}>
                <SfIcon name="wave.3.right" size={24} color={CardMetalColors.etch} />
              </View>
              <ThemedText
                variant="caption"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ ...ETCH_TEXT, fontFamily: 'Menlo', opacity: 0.6 }}>
                {props.displayUrl}
              </ThemedText>
            </LinearGradient>
          </Animated.View>
        </Pressable>
      </Animated.View>

      {/* `.card-acts` — the mock's quiet underlined flip control. Without it
          the only way to discover the back is to guess that the card taps. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.flipLabel}
        hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
        onPress={toggleFlip}
        style={{ alignSelf: 'center' }}>
        <ThemedText
          variant="caption"
          tone="secondary"
          style={{ textDecorationLine: 'underline' }}>
          {props.flipLabel}
        </ThemedText>
      </Pressable>
    </View>
  );
}
