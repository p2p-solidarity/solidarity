/**
 * PageHeaderAction — the Page tab's top-right control, ported from the mock's
 * `.gear` (`creds-design/verified-linkinbio-mock-v3.html` §`#s-page`): a 34pt
 * outlined square holding a 16pt glyph. Share / appearance / settings all use
 * it so the three read as one row of "things you do to the whole page".
 *
 * The visible box stays 34pt as drawn; the touch target is padded out to 44pt
 * (rule 6) by the wrapper, exactly the trick the mock does with its
 * pseudo-element hit areas.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';

/** `.gear` — 34×34 box. */
export const PAGE_HEADER_ACTION_BOX = 34;
/** Hit area: full 44 tall, 40 wide. The row's 7pt gutter means padding both
 *  sides out to 44 would make neighbouring targets overlap — the same
 *  trade-off the mock takes for its own icon-button row. */
const HIT_SLOP = { top: 5, bottom: 5, left: 3, right: 3 } as const;

export interface PageHeaderActionProps {
  readonly icon: SFSymbol;
  readonly label: string;
  readonly onPress: () => void;
}

export function PageHeaderAction({ icon, label, onPress }: PageHeaderActionProps): ReactNode {
  return (
    <PressableScale
      haptic="tap"
      scaleTo={SCALE.icon}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
      style={{
        width: PAGE_HEADER_ACTION_BOX,
        height: PAGE_HEADER_ACTION_BOX,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: Colors.divider,
        backgroundColor: Colors.cardBg,
      }}>
      <SfIcon name={icon} size={16} color={Colors.text1} />
    </PressableScale>
  );
}

/** `.topacts` — the row the three actions live in. */
export function PageHeaderActions({ children }: { readonly children: ReactNode }): ReactNode {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>{children}</View>;
}
