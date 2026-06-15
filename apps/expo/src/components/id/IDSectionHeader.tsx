/**
 * IDSectionHeader — uppercased monospaced 12pt bold section header used
 * across IDViews. Mirrors `Text("FOO").font(.system(size: 12, weight: .bold,
 * design: .monospaced)).foregroundColor(Color.Theme.textTertiary)` from
 * solidarity/Views/IDViews/* (e.g. GroupIdentityView headerSection,
 * ZKSettingsView, GroupJoinSheet, etc.).
 *
 * The Swift originals use textTertiary for the SCREAMING_SNAKE labels
 * ("SELECTED GROUP", "ACTIONS", "INVITE TOKEN") and textSecondary for the
 * proper-case ones ("Members", "Group Info", "Identity Info"). `tone` lets
 * the caller pick which one matches the source.
 */
import type { ReactNode } from 'react';
import { Text } from 'react-native';

const MONO_FONT = 'Menlo';

export type IDSectionHeaderTone = 'tertiary' | 'secondary';

export interface IDSectionHeaderProps {
  readonly title: string;
  readonly tone?: IDSectionHeaderTone;
}

export function IDSectionHeader({
  title,
  tone = 'tertiary',
}: IDSectionHeaderProps): ReactNode {
  const cls = tone === 'tertiary' ? 'text-text3' : 'text-text2';
  return (
    <Text
      className={`${cls} text-[12px] font-bold`}
      style={{ fontFamily: MONO_FONT }}
    >
      {title}
    </Text>
  );
}
