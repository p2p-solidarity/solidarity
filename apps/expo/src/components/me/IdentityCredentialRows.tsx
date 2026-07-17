import { router, useFocusEffect } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useCallback, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { hasNostrKey, hasNostrKeySync } from '@/nostr/userKey';
import type { ProfileRecord } from '@solidarity/shared';

export interface IdentityCredentialRowsProps {
  readonly record: ProfileRecord;
  readonly onOpenBindings: () => void;
  readonly onOpenCredentials: () => void;
}

export function IdentityCredentialRows({
  record,
  onOpenBindings,
  onOpenCredentials,
}: IdentityCredentialRowsProps): ReactNode {
  const { t } = useTranslation();
  const [nostrKeyReady, setNostrKeyReady] = useState(() => hasNostrKeySync());
  const [bindingsExpanded, setBindingsExpanded] = useState(false);
  const blueskyHandle =
    record.alsoKnownAs.find((alias) => alias.startsWith('at://'))?.slice('at://'.length) ?? null;
  const nostrClaimed = record.alsoKnownAs.some((alias) => alias.startsWith('nostr:npub'));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void hasNostrKey().then((has) => {
        if (!cancelled) setNostrKeyReady(has);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View className="gap-3 px-4">
      <ThemedText variant="label" tone="tertiary">
        {t('mePage.identityAndCredentials')}
      </ThemedText>
      <ThemedSurface variant="inset" className="overflow-hidden rounded-none">
        <InsetRow
          icon="checkmark.seal"
          title={t('mePage.identityAndBindings')}
          subtitle={t('mePage.bindingsPortableHint')}
          trailingIcon={bindingsExpanded ? 'chevron.up' : 'chevron.down'}
          onPress={() => {
            setBindingsExpanded((expanded) => !expanded);
          }}
        />
        {bindingsExpanded ? (
          <>
            <View style={{ height: 1, marginLeft: 48, backgroundColor: Colors.divider }} />
            <InsetRow
              icon="checkmark.seal.fill"
              title={t('mePage.blueskyBinding')}
              subtitle={
                blueskyHandle === null
                  ? t('mePage.bindingNotConnected')
                  : t('mePage.blueskyClaimed', { handle: blueskyHandle })
              }
              onPress={() => {
                router.push('/verify/bluesky');
              }}
            />
            <View style={{ height: 1, marginLeft: 48, backgroundColor: Colors.divider }} />
            <InsetRow
              icon="globe"
              title={t('mePage.nostrBinding')}
              subtitle={
                nostrClaimed
                  ? t('mePage.nostrClaimed')
                  : nostrKeyReady
                    ? t('mePage.nostrReadyToBind')
                    : t('mePage.bindingNotConnected')
              }
              onPress={onOpenBindings}
            />
          </>
        ) : null}
        <View style={{ height: 1, marginLeft: 48, backgroundColor: Colors.divider }} />
        <InsetRow
          icon="checkmark.shield.fill"
          title={t('mePage.credentials')}
          subtitle={t('mePage.credentialsHint')}
          onPress={onOpenCredentials}
        />
      </ThemedSurface>
    </View>
  );
}

function InsetRow({
  icon,
  title,
  subtitle,
  onPress,
  trailingIcon = 'chevron.right',
}: {
  readonly icon: SFSymbol;
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
  readonly trailingIcon?: SFSymbol;
}): ReactNode {
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={{
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}>
      <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name={icon} size={15} color={Colors.text1} />
      </View>
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodyMedium">{title}</ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {subtitle}
        </ThemedText>
      </View>
      <SfIcon name={trailingIcon} size={12} color={Colors.text3} />
    </PressableScale>
  );
}
