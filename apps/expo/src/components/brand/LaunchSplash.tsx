import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Path, Svg } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  BRAND_MARK_BOTTOM_ARC,
  BRAND_MARK_TOP_ARC,
  BRAND_MARK_VIEWBOX,
} from '@/components/brand/BrandMark';
import { Colors } from '@/constants/Colors';
import { SPRING } from '@/feedback/motion';

const MARK_SIZE = 220;
const UNLINK_DISTANCE = 18;
const UNLINK_DURATION_MS = 200;
const REVEAL_DELAY_MS = 520;
const REDUCED_MOTION_HOLD_MS = 150;
const FINISH_TIMEOUT_MS = 1500;
const UNLINK_EASING = Easing.bezier(0.77, 0, 0.175, 1);
const REVEAL_EASING = Easing.out(Easing.cubic);

export function LaunchSplash({
  onFinished,
  onHideError,
}: {
  readonly onFinished: () => void;
  readonly onHideError: (error: unknown) => void;
}): ReactNode {
  const reduceMotion = useReducedMotion();
  const topOffset = useSharedValue(0);
  const bottomOffset = useSharedValue(0);
  const markScale = useSharedValue(1);
  const markOpacity = useSharedValue(1);
  const backgroundOpacity = useSharedValue(1);
  const finished = useRef(false);
  const nativeSplashHideScheduled = useRef(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinishedRef.current();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(finish, FINISH_TIMEOUT_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [finish]);

  useEffect(() => {
    topOffset.value = 0;
    bottomOffset.value = 0;
    markScale.value = 1;
    markOpacity.value = 1;
    backgroundOpacity.value = 1;

    const revealDelay = reduceMotion
      ? REDUCED_MOTION_HOLD_MS
      : REVEAL_DELAY_MS;

    if (!reduceMotion) {
      topOffset.value = withTiming(
        -UNLINK_DISTANCE,
        { duration: UNLINK_DURATION_MS, easing: UNLINK_EASING },
        (didFinish) => {
          if (didFinish) topOffset.value = withSpring(0, SPRING.gentle);
        }
      );
      bottomOffset.value = withTiming(
        UNLINK_DISTANCE,
        { duration: UNLINK_DURATION_MS, easing: UNLINK_EASING },
        (didFinish) => {
          if (didFinish) bottomOffset.value = withSpring(0, SPRING.gentle);
        }
      );
      markScale.value = withDelay(
        revealDelay,
        withTiming(1.06, { duration: 220, easing: REVEAL_EASING })
      );
    }

    markOpacity.value = withDelay(
      revealDelay,
      withTiming(0, { duration: 220, easing: REVEAL_EASING })
    );
    backgroundOpacity.value = withDelay(
      revealDelay,
      withTiming(0, { duration: 260, easing: REVEAL_EASING }, (didFinish) => {
        if (didFinish) scheduleOnRN(finish);
      })
    );
  }, [backgroundOpacity, bottomOffset, finish, markOpacity, markScale, reduceMotion, topOffset]);

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.value,
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const topArcStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: topOffset.value }],
  }));
  const bottomArcStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bottomOffset.value }],
  }));

  const hideNativeSplashAfterFirstFrame = () => {
    if (nativeSplashHideScheduled.current) return;
    nativeSplashHideScheduled.current = true;
    requestAnimationFrame(() => {
      void SplashScreen.hideAsync().catch(onHideError);
    });
  };

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={hideNativeSplashAfterFirstFrame}
      style={styles.container}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.background, { backgroundColor: Colors.splashBg }, backgroundStyle]}
      />
      <Animated.View style={[styles.mark, markStyle]}>
        <Animated.View style={[styles.arc, topArcStyle]}>
          <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox={BRAND_MARK_VIEWBOX}>
            <Path d={BRAND_MARK_TOP_ARC} fill={Colors.splashMark} />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.arc, bottomArcStyle]}>
          <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox={BRAND_MARK_VIEWBOX}>
            <Path d={BRAND_MARK_BOTTOM_ARC} fill={Colors.splashMark} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  background: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
  },
  arc: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
