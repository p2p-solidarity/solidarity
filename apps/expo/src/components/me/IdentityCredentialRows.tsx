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
import { usePreferences } from '@/settings/preferences';
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
  const rootKeySyncChoice = usePreferences((s) => s.rootKeySyncChoice);
  const [nostrKeyReady, setNostrKeyReady] = useState(() => hasNostrKeySync());
  const [expanded, setExpanded] = useState(false);
  // Real backup state — the pref is always one of exactly three concrete
  // values (no loading/error: it's a synchronous MMKV pref with a default).
  const backupUnset = rootKeySyncChoice === 'undecided';
  const backup: { readonly icon: SFSymbol; readonly title: string; readonly subtitle: string } =
    rootKeySyncChoice === 'icloud'
      ? {
          icon: 'checkmark.icloud.fill',
          title: t('meHome.backupStatus.icloudTitle'),
          subtitle: t('meHome.backupStatus.icloudHint'),
        }
      : rootKeySyncChoice === 'mnemonicOnly'
        ? {
            icon: 'key.horizontal',
            title: t('meHome.backupStatus.mnemonicTitle'),
            subtitle: t('meHome.backupStatus.mnemonicHint'),
          }
        : {
            icon: 'exclamationmark.triangle.fill',
            title: t('meHome.backupStatus.noneTitle'),
            subtitle: t('meHome.backupStatus.noneHint'),
          };
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
    <View className="px-4">
      <ThemedSurface variant="inset" className="overflow-hidden rounded-none">
        <InsetRow
          icon="checkmark.seal"
          title={t('meHome.identityCredentialsTitle')}
          subtitle={t('meHome.identityCredentialsHint')}
          trailingIcon={expanded ? 'chevron.up' : 'chevron.down'}
          expanded={expanded}
          onPress={() => {
            setExpanded((current) => !current);
          }}
        />
        {expanded ? (
          <>
            <View style={{ height: 1, marginLeft: 48, backgroundColor: Colors.divider }} />
            <InsetRow
              icon={backup.icon}
              iconColor={backupUnset ? Colors.warning : Colors.text1}
              title={backup.title}
              titleColor={backupUnset ? Colors.warning : undefined}
              subtitle={backup.subtitle}
              onPress={() => {
                router.push('/settings/identity-export');
              }}
            />
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
            <View style={{ height: 1, marginLeft: 48, backgroundColor: Colors.divider }} />
            <InsetRow
              icon="checkmark.shield.fill"
              title={t('mePage.credentials')}
              subtitle={t('mePage.credentialsHint')}
              onPress={onOpenCredentials}
            />
            <View style={{ height: 1, marginLeft: 48, backgroundColor: Colors.divider }} />
            <InsetRow
              icon="qrcode"
              title={t('evidencePack.entryTitle')}
              subtitle={t('evidencePack.entryHint')}
              onPress={() => {
                router.push('/me/evidence-pack');
              }}
            />
          </>
        ) : null}
      </ThemedSurface>
    </View>
  );
}

function InsetRow({
  icon,
  iconColor = Colors.text1,
  title,
  titleColor,
  subtitle,
  onPress,
  trailingIcon = 'chevron.right',
  expanded,
}: {
  readonly icon: SFSymbol;
  readonly iconColor?: string;
  readonly title: string;
  readonly titleColor?: string;
  readonly subtitle: string;
  readonly onPress: () => void;
  readonly trailingIcon?: SFSymbol;
  readonly expanded?: boolean;
}): ReactNode {
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={{
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}>
      <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name={icon} size={15} color={iconColor} />
      </View>
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodyMedium" style={titleColor ? { color: titleColor } : undefined}>
          {title}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {subtitle}
        </ThemedText>
      </View>
      <SfIcon name={trailingIcon} size={12} color={Colors.text3} />
    </PressableScale>
  );
}
