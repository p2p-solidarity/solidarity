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

import { animalImageSource } from '@/cards/animals';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { ON_LIGHT } from '@/components/themed/contrast';
import { Colors } from '@/constants/Colors';
import type { AnimalCharacter } from '@/settings/preferences';

const CARD_HEIGHT = 220;
const CARD_RADIUS = 20;
const CARD_QR_SIZE = 68;

const ANIMAL_GRADIENT_END: Readonly<Record<AnimalCharacter, string>> = {
  dog: Colors.cardDog,
  horse: Colors.cardHorse,
  pig: Colors.cardPig,
  sheep: Colors.cardSheep,
  dove: Colors.cardDove,
};

export type CardQrState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly uri: string }
  | { readonly kind: 'error' };

function profileInitial(name: string | null): string {
  const initial = name?.trim().charAt(0).toUpperCase();
  return initial === undefined || initial === '' ? '?' : initial;
}

function CardQr({ state }: { readonly state: CardQrState }): ReactNode {
  let content: ReactNode;
  if (state.kind === 'ready') {
    content = (
      <Image
        source={{ uri: state.uri }}
        contentFit="contain"
        style={{ width: CARD_QR_SIZE - 8, height: CARD_QR_SIZE - 8 }}
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
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.cardBg,
        padding: 4,
      }}>
      {content}
    </View>
  );
}

function CardIdentity({
  animal,
  name,
  company,
  title,
  skills,
}: {
  readonly animal: AnimalCharacter | null | undefined;
  readonly name: string | null;
  readonly company: string | null;
  readonly title: string | null;
  readonly skills: readonly string[];
}): ReactNode {
  return (
    <View className="flex-1 flex-row items-center gap-4">
      {animal ? (
        <Image
          source={animalImageSource(animal)}
          contentFit="cover"
          style={{ width: 84, height: 84, borderRadius: 18 }}
        />
      ) : (
        <View
          className="h-[84px] w-[84px] items-center justify-center rounded-[18px]"
          style={{ backgroundColor: Colors.cardSurface }}>
          <ThemedText variant="headlineLarge" style={{ color: Colors.primaryMauve }}>
            {profileInitial(name)}
          </ThemedText>
        </View>
      )}

      <View className="min-w-0 flex-1 gap-1.5">
        {name ? (
          <ThemedText variant="titleLarge" numberOfLines={1} style={{ color: ON_LIGHT }}>
            {name}
          </ThemedText>
        ) : null}
        {company ? (
          <ThemedText variant="bodyMedium" numberOfLines={1} style={{ color: ON_LIGHT }}>
            {company}
          </ThemedText>
        ) : null}
        {title ? (
          <ThemedText variant="caption" numberOfLines={1} style={{ color: ON_LIGHT }}>
            {title}
          </ThemedText>
        ) : null}
        {skills.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {skills.map((skill) => (
              <View
                key={skill}
                className="rounded-full px-2 py-1"
                style={{ backgroundColor: Colors.cardSurface }}>
                <ThemedText variant="caption" style={{ color: ON_LIGHT }}>
                  {skill}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

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
  readonly selectedAnimal: AnimalCharacter | null;
  readonly animal: AnimalCharacter | null | undefined;
  readonly name: string | null;
  readonly company: string | null;
  readonly title: string | null;
  readonly skills: readonly string[];
  readonly category: string;
  readonly summary: string;
  readonly displayUrl: string;
  readonly qrState: CardQrState;
  readonly flipLabel: string;
}

export function PresentCardVisual(props: PresentCardVisualProps): ReactNode {
  const [isFlipped, setIsFlipped] = useState(false);
  const { tiltStyle, frontStyle, backStyle } = useCardMotion(isFlipped);
  const activeAnimal = props.animal ?? props.selectedAnimal;
  const gradientEnd = activeAnimal
    ? `${ANIMAL_GRADIENT_END[activeAnimal]}99`
    : `${props.resolvedAccent}4D`;
  const faceStyle = {
    position: 'absolute' as const,
    inset: 0,
    overflow: 'hidden' as const,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: `${props.resolvedAccent}59`,
    backfaceVisibility: 'hidden' as const,
  };

  return (
    <Animated.View style={tiltStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.flipLabel}
        accessibilityState={{ expanded: isFlipped }}
        onPress={() => {
          setIsFlipped((value) => !value);
        }}
        style={{
          height: CARD_HEIGHT,
          borderRadius: CARD_RADIUS,
          shadowColor: props.enableGlow ? props.resolvedAccent : Colors.text1,
          shadowOpacity: props.enableGlow ? 0.34 : 0.22,
          shadowRadius: props.enableGlow ? 24 : 22,
          shadowOffset: { width: 0, height: 12 },
          elevation: 8,
        }}>
        <Animated.View style={[faceStyle, frontStyle]}>
          <LinearGradient
            colors={[Colors.warmCream, gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1, padding: 18 }}>
            <CardSheen enabled={props.enableGlow} />
            <View className="flex-row items-start justify-between gap-3">
              <View
                className="rounded-full px-3 py-1"
                style={{ backgroundColor: props.resolvedAccent }}>
                <ThemedText variant="caption" style={{ color: Colors.invertedButtonText }}>
                  {props.category}
                </ThemedText>
              </View>
              <SfIcon name="arrow.triangle.2.circlepath" size={18} color={ON_LIGHT} />
            </View>
            <CardIdentity
              animal={props.animal}
              name={props.name}
              company={props.company}
              title={props.title}
              skills={props.skills}
            />
            <View className="flex-row items-end justify-between gap-3">
              <View className="min-w-0 flex-1 gap-1">
                <ThemedText variant="caption" style={{ color: ON_LIGHT }}>
                  {props.summary}
                </ThemedText>
                <ThemedText variant="bodySmall" numberOfLines={1} style={{ color: ON_LIGHT }}>
                  {props.displayUrl}
                </ThemedText>
              </View>
              <CardQr state={props.qrState} />
            </View>
          </LinearGradient>
        </Animated.View>
        <Animated.View style={[faceStyle, backStyle]}>
          <LinearGradient
            colors={[Colors.warmCream, gradientEnd]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18 }}>
            <CardSheen enabled={props.enableGlow} />
            <CardQr state={props.qrState} />
            <ThemedText variant="titleMedium" style={{ color: ON_LIGHT }}>
              {props.name}
            </ThemedText>
            <ThemedText variant="bodySmall" numberOfLines={1} style={{ color: ON_LIGHT }}>
              {props.displayUrl}
            </ThemedText>
            <View className="flex-row items-center gap-1">
              <SfIcon name="arrow.triangle.2.circlepath" size={12} color={ON_LIGHT} />
              <ThemedText variant="caption" style={{ color: ON_LIGHT }}>
                {props.flipLabel}
              </ThemedText>
            </View>
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
