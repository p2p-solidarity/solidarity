/**
 * WinSystemErrorDialog — 1:1 port of solidarity/Views/Common/WinSystemErrorDialog.swift.
 *
 * Neo-Brutalist error modal styled after a Windows-95 system dialog: solid
 * blue 2pt outer border, dashed blue inner border around the message
 * block, sharp-edged buttons (Inverted = primary, Primary = secondary in
 * Swift's naming). Used as a stylised error surface for dev / failure
 * flows; mounted over a black 80% backdrop with a spring scale entrance.
 */
import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

export interface WinSystemErrorDialogProps {
  readonly visible: boolean;
  readonly title?: string;
  readonly message: string;
  readonly primaryActionTitle?: string;
  readonly primaryAction?: () => void;
  readonly secondaryActionTitle?: string;
  readonly secondaryAction?: () => void;
  readonly onDismiss: () => void;
}

export function WinSystemErrorDialog({
  visible,
  title = 'Something went wrong :(',
  message,
  primaryActionTitle = 'Go Back',
  primaryAction,
  secondaryActionTitle,
  secondaryAction,
  onDismiss,
}: WinSystemErrorDialogProps): ReactNode {
  const scale = useSharedValue(0.95);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      haptic('error');
      scale.value = withSpring(1, { damping: 12, stiffness: 180 });
      opacity.value = withTiming(1, { duration: 180 });
    } else {
      scale.value = 0.95;
      opacity.value = 0;
    }
  }, [visible, scale, opacity]);

  const dialogStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.8)',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Animated.View
          style={[
            {
              backgroundColor: Colors.cardBg,
              borderWidth: 2,
              borderColor: Colors.primaryBlue,
              padding: 20,
              rowGap: 24,
            },
            dialogStyle,
          ]}
        >
          <View
            style={{
              padding: 16,
              borderWidth: 1,
              borderColor: Colors.primaryBlue,
              borderStyle: 'dashed',
              rowGap: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '700',
                  color: Colors.text1,
                  flex: 1,
                }}
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                onPress={() => {
                  haptic('tap');
                  onDismiss();
                }}
                hitSlop={8}
                style={{
                  padding: 4,
                  borderWidth: 1,
                  borderColor: Colors.primaryBlue,
                  borderStyle: 'dashed',
                }}
              >
                <SfIcon name="xmark" size={14} color={Colors.text1} weight="semibold" />
              </Pressable>
            </View>

            <Text
              style={{
                fontSize: 16,
                color: Colors.text2,
                lineHeight: 22,
              }}
            >
              {message}
            </Text>
          </View>

          <View style={{ rowGap: 12 }}>
            <ThemedButton
              label={primaryActionTitle}
              variant="inverted"
              size="lg"
              fullWidth
              onPress={() => {
                onDismiss();
                primaryAction?.();
              }}
            />
            {secondaryActionTitle && secondaryAction ? (
              <ThemedButton
                label={secondaryActionTitle}
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => {
                  onDismiss();
                  secondaryAction();
                }}
              />
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
