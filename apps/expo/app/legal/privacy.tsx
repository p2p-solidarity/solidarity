/**
 * Privacy Policy viewer — renders the bundled PRIVACY_POLICY.md via the
 * shared MarkdownDocument component. The markdown is copied into a TS
 * module at `src/legal/privacy.ts` so Metro bundles it as a string and
 * TypeScript keeps the import typed.
 */
import { safeBack } from '@/navigation/safeBack';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarkdownDocument } from '@/components/common/MarkdownDocument';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { PRIVACY_POLICY_MARKDOWN } from '@/legal/privacy';

export default function PrivacyPolicyPage(): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack(); }} />
      <SettingsScreenTitle title="Privacy Policy" />
      <MarkdownDocument source={PRIVACY_POLICY_MARKDOWN} />
    </View>
  );
}
