/**
 * GroupVCIssuanceSection — 1:1 port of Swift GroupVCIssuanceSection
 *   (solidarity/Views/IDViews/GroupDetailView/GroupVCIssuanceSection.swift).
 *
 * Sits inside the GroupDetailView "Admin Tools" stack:
 *   • Header "Issue Group Credential" (12pt mono bold text2)
 *   • If `canIssue` (owner OR in credentialIssuers): Primary "Issue New
 *     Group VC" button (doc.badge.plus) + optional summary line from the
 *     most-recent issuance.
 *   • Otherwise: lock.fill icon + "Only credential issuers can issue
 *     Group VCs" hint.
 *   • Tapping the button pushes /groups/[id]/issue-vc.
 */
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { SectionHeader } from './GroupDetailSections';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  canIssueCredentials as canIssue,
  type GroupModel,
} from '@/groups/store';

const MONO_FONT = 'Menlo';

export interface GroupVCIssuanceSectionProps {
  readonly group: GroupModel;
  /** Optional summary surfaced from a prior issuance (parent owns state). */
  readonly lastIssuanceSummary?: string | null;
}

export function GroupVCIssuanceSection({
  group,
  lastIssuanceSummary,
}: GroupVCIssuanceSectionProps): ReactNode {
  const [internalSummary] = useState<string | null>(null);
  const summary = lastIssuanceSummary ?? internalSummary;
  const allowed = canIssue(group);

  return (
    <View
      className="bg-searchBg p-4"
      style={{ borderWidth: 1, borderColor: Colors.divider, gap: 12 }}
    >
      <SectionHeader title="Issue Group Credential" />

      {allowed ? (
        <>
          <ThemedButton
            variant="primary"
            label="Issue New Group VC"
            fullWidth
            leadingIcon={
              <SfIcon name="doc.badge.plus" size={14} color={Colors.text1} />
            }
            onPress={() => {
              router.push({
                pathname: '/groups/[id]/issue-vc',
                params: { id: group.id },
              });
            }}
          />
          {summary ? (
            <Text
              style={{ fontFamily: MONO_FONT }}
              className="text-text3 text-[12px]"
            >
              {summary}
            </Text>
          ) : null}
        </>
      ) : (
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <SfIcon name="lock.fill" size={14} color={Colors.text3} />
          <Text className="text-text2 text-[14px] flex-1">
            Only credential issuers can issue Group VCs
          </Text>
        </View>
      )}
    </View>
  );
}
