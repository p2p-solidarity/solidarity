/**
 * Haptic feedback bridge — mirrors Swift HapticFeedbackManager.
 *
 * Funnels every haptic call through one module so feedback feels
 * consistent across the app (and so we can opt-out for accessibility
 * users in one place).
 */
import * as Haptics from 'expo-haptics';

export type HapticKind =
  | 'selection'
  | 'tap'
  | 'soft'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';

const MAP: Readonly<Record<HapticKind, () => Promise<void>>> = {
  selection: async () => Haptics.selectionAsync(),
  tap: async () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  // Soft + Heavy mirror Swift HapticFeedbackManager — used by the UWB
  // bump driver (docs §3.3.1) for approaching / confirmed transitions.
  soft: async () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  heavy: async () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: async () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: async () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: async () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export function haptic(kind: HapticKind): void {
  void MAP[kind]().catch(() => {
    // Haptics aren't critical — swallow errors silently so a missing
    // engine on Simulator never crashes the calling flow.
  });
}
