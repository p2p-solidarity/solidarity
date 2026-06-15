/**
 * DisclosureRowView — Figma 724:22770. Swift parity:
 *   • 14pt terminalGreen leading icon (18pt frame)
 *   • 15pt title + 11pt tertiary source line (e.g. "Src:Profile")
 *   • Show button: 13pt medium, text1 fill, pageBg label, corner 2,
 *     min width 56, min height 28
 *   • Card: mutedSurface, corner 8, pad horiz 12 vert 16, horiz mx 16
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (DisclosureRowView).
 *
 * Work-context extension (net-new, no Swift/Figma source): when a claim can
 * also be presented under a real work/group context (the user's card carries
 * `groupContext.type === 'group'`), an optional `work` action renders a
 * second dark button right-aligned next to "Show". It is ONLY passed when a
 * real context exists — there is no no-op placeholder (CLAUDE.md rule 8).
 */
import type { SFSymbol } from 'expo-symbols';
import { ActivityIndicator, Text, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

/** A single dark action button (Figma 743:2985 "Show"). */
export interface DisclosureRowAction {
  title: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

export interface DisclosureRowViewProps {
  icon: SFSymbol;
  title: string;
  /** Already-formatted, e.g. "Src:Profile". */
  source: string;
  actionTitle?: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  onPresent: () => void;
  /**
   * Optional second action for presenting under the work/group context.
   * Pass ONLY when the backing card has a real `groupContext.type ===
   * 'group'`; omit otherwise so no dead "Work" button ever ships.
   */
  work?: DisclosureRowAction;
}

function ActionButton({ action }: { action: DisclosureRowAction }) {
  const disabled = action.isDisabled ?? false;
  const loading = action.isLoading ?? false;
  return (
    <PressableScale
      haptic="tap"
      onPress={action.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.title}
      className="rounded-sm2"
      style={{
        minWidth: 56,
        minHeight: 28,
        backgroundColor: Colors.invertedButtonBg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
        opacity: disabled && !loading ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={Colors.pageBg} />
      ) : (
        <Text style={{ color: Colors.pageBg }} className="text-[13px] font-medium">
          {action.title}
        </Text>
      )}
    </PressableScale>
  );
}

export function DisclosureRowView({
  icon,
  title,
  source,
  actionTitle = 'Show',
  isLoading = false,
  isDisabled = false,
  onPresent,
  work,
}: DisclosureRowViewProps) {
  return (
    <View className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-4">
      <View
        style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
      >
        <SfIcon name={icon} size={14} color={Colors.terminalGreen} />
      </View>

      <View className="flex-1 gap-1">
        <Text className="text-text1 text-[15px]">{title}</Text>
        <Text className="text-text3 text-[11px]">{source}</Text>
      </View>

      {/* Right-aligned action group — "Show" plus optional "Work" when a
          real work/group context exists (Figma 724:22770 button cluster). */}
      <View className="flex-row items-center gap-2">
        <ActionButton
          action={{
            title: actionTitle,
            isLoading,
            isDisabled,
            onPress: onPresent,
          }}
        />
        {work ? <ActionButton action={work} /> : null}
      </View>
    </View>
  );
}
