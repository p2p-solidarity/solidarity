/**
 * EditOnWebCard — the Page tab's hand-off to the desktop editor (07-plan
 * 階段 2). Nothing new on the wire: the SAME share link the owner already
 * hands out opens the public viewer, whose「Edit this page」loads the signed
 * page into `creds.id/edit`; the edited draft comes back as a webSign QR the
 * scanner already understands (`websign/transport.ts`) and the review screen
 * root-signs after a per-field diff.
 *
 * States are exactly `ready` (a share URL exists) and `unavailable` (nothing
 * published or shareable yet) — never a placeholder link (Rule 8).
 */
import * as Clipboard from 'expo-clipboard';
import type { ReactNode } from 'react';
import { Share, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';

export interface EditOnWebCardProps {
  /** The owner's current share URL (fragment, short pointer, or `/@name`), or null while none exists. */
  readonly url: string | null;
}

export function EditOnWebCard({ url }: EditOnWebCardProps): ReactNode {
  const { t } = useTranslation();

  const onCopy = async (): Promise<void> => {
    if (url === null) return;
    await Clipboard.setStringAsync(url);
    haptic('success');
    pushToast(t('mePage.editOnWeb.copied'), 'success');
  };

  const onShare = async (): Promise<void> => {
    if (url === null) return;
    try {
      await Share.share({ message: url, url });
    } catch {
      haptic('warning');
    }
  };

  return (
    <View className="px-4">
      <ThemedSurface variant="card" padded style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SfIcon name="desktopcomputer" size={16} color={Colors.text1} />
          <ThemedText variant="label">{t('mePage.editOnWeb.title')}</ThemedText>
        </View>
        <ThemedText variant="bodySmall" tone="secondary">
          {url === null ? t('mePage.editOnWeb.unavailable') : t('mePage.editOnWeb.body')}
        </ThemedText>
        {url === null ? null : (
          <>
            <ThemedText variant="caption" tone="tertiary" selectable numberOfLines={1}>
              {url}
            </ThemedText>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ThemedButton
                label={t('mePage.editOnWeb.copy')}
                variant="secondary"
                size="md"
                leadingIcon={<SfIcon name="doc.on.doc" size={14} color={Colors.text1} />}
                onPress={() => { void onCopy(); }}
              />
              <ThemedButton
                label={t('mePage.editOnWeb.share')}
                variant="secondary"
                size="md"
                leadingIcon={<SfIcon name="square.and.arrow.up" size={14} color={Colors.text1} />}
                onPress={() => { void onShare(); }}
              />
            </View>
          </>
        )}
      </ThemedSurface>
    </View>
  );
}
