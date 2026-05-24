/**
 * Terms of Service viewer — renders the bundled TERMS_OF_SERVICE.md via
 * the shared MarkdownDocument component. The markdown is bundled as a
 * TS module at `src/legal/terms.ts` for zero-config Metro inclusion.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarkdownDocument } from '@/components/common/MarkdownDocument';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { TERMS_OF_SERVICE_MARKDOWN } from '@/legal/terms';

export default function TermsOfServicePage(): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Terms of Service" />
      <MarkdownDocument source={TERMS_OF_SERVICE_MARKDOWN} />
    </View>
  );
}
