/**
 * GroupVCIssuanceSection — 1:1 port of Swift GroupVCIssuanceSection
 *   (solidarity/Views/IDViews/GroupDetailView/GroupVCIssuanceSection.swift).
 *
 * Sits inside the GroupDetailView "Admin Tools" stack:
 *   • Header "Issue Group Credential" (12pt mono bold text2)
 * Group issuance remains visible as a disabled developer capability until
 * the signing and delivery services exist. It must never fabricate a VC.
 */
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { SectionHeader } from './GroupDetailSections';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { GroupModel } from '@/groups/store';

const MONO_FONT = 'Menlo';

export interface GroupVCIssuanceSectionProps {
  readonly group: GroupModel;
}

export function GroupVCIssuanceSection({
  group: _group,
}: GroupVCIssuanceSectionProps): ReactNode {
  const { t } = useTranslation();

  return (
    <View
      className="bg-searchBg p-4"
      style={{ borderWidth: 1, borderColor: Colors.divider, gap: 12 }}
    >
      <SectionHeader title="Issue Group Credential" />

      <ThemedButton
        variant="secondary"
        label={t('groupIssue.unavailableButton')}
        fullWidth
        disabled
        leadingIcon={<SfIcon name="lock.fill" size={14} color={Colors.text3} />}
      />
      <Text
        style={{ fontFamily: MONO_FONT }}
        className="text-text3 text-[12px]"
      >
        {t('groupIssue.unavailableReason')}
      </Text>
    </View>
  );
}
