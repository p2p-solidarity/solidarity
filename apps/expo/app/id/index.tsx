/**
 * IDView — 1:1 port of Swift IDView
 *   (solidarity/Views/IDViews/IDView.swift +
 *    solidarity/Views/IDViews/IDViewHelpers.swift).
 *
 * Top-level layout (matches Swift exactly):
 *   • Nav: leading gearshape (→ /id/zk-settings), title "ID" (inline),
 *     trailing MatchingBarView (TODO: port), qrcode (→ /scan), and
 *     arrow.clockwise (refresh identity).
 *   • Section 1 — "The Mask": DID switcher capsule (Anonymous / did:key)
 *     + short-DID copy chip below it.
 *   • Section 2 — "The Core": RippleButton (320pt tall slot).
 *   • Section 3 — "The Badge": dev-mode group list with header + plus
 *     button + per-group BadgeGroupRow cards. Tap → present proof; in
 *     this port we route to the group detail and let the user kick off
 *     the proof flow from there.
 *
 * TODO(android): wire IdentityCoordinator (DID, profile, refresh) and
 * SemaphoreIdentityManager (loadOrCreateIdentity, commitment) once the
 * Nitro modules land. The visual contract is preserved by reading from
 * the local stores and toasting on unimplemented actions.
 */
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BadgeGroupRow,
  DidCapsule,
  RippleButton,
  shortDid,
  type RippleButtonState,
} from '@/components/id';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useGroupManifest, useGroupStore, type GroupManifestEntry } from '@/groups/store';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';
import { useIdentitySnapshot, useZkIdentity } from '@/zk';

export default function IDViewScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { did, commitment } = useIdentitySnapshot();
  const isWorkingFromStore = useZkIdentity((s) => s.isWorking);
  const seedFromNative = useZkIdentity((s) => s.seedFromNative);
  const createIdentity = useZkIdentity((s) => s.createIdentity);
  const [isWorkingLocal, setIsWorkingLocal] = useState(false);
  const isWorking = isWorkingFromStore || isWorkingLocal;
  const developerMode = usePreferences((s) => s.developerMode);

  // Frame-1 group list comes from the synchronous manifest (id / name /
  // memberCount). The full record (ownerRecordID, merkleRoot, isSynced) is
  // background-decrypted by `hydrate()` and only needed when the user opens
  // a group's detail.
  const seedFromManifest = useGroupStore((s) => s.seedFromManifest);
  const hydrate = useGroupStore((s) => s.hydrate);
  const groups = useGroupManifest();

  useEffect(() => {
    seedFromManifest();
    void hydrate();
    void seedFromNative();
  }, [seedFromManifest, hydrate, seedFromNative]);

  const rippleState: RippleButtonState = isWorking ? 'processing' : 'idle';
  const isDidKeyActive = did === null || did.startsWith('did:key');

  const onCoreTap = (): void => {
    if (commitment === null) {
      // Mirror Swift createIdentity() — real call into the Nitro module.
      setIsWorkingLocal(true);
      void createIdentity()
        .then(() => {
          haptic('success');
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          pushToast(`${t('idView.identityCreationFailed')}: ${message}`, 'warning');
        })
        .finally(() => {
          setIsWorkingLocal(false);
        });
    } else {
      // TODO(android): IdentityCoordinator.refreshIdentity() — full refresh
      // sweep (DID metadata, group root pulls) lands in a follow-up iteration;
      // for now the ZK identity itself is already authoritative.
      pushToast(t('idView.identityUpToDate'), 'info');
    }
  };

  const onCoreLongPress = (): void => {
    // Swift presents the GroupManagementView sheet.
    router.push('/settings/groups');
  };

  const onSwitchDid = (): void => {
    // did:key is currently the only supported method; capsule kept for
    // visual parity with Swift but no-ops on press.
    pushToast(t('idView.didKeyOnly'), 'info');
  };

  const onCopyDid = async (): Promise<void> => {
    if (!did) return;
    await Clipboard.setStringAsync(did);
    haptic('selection');
    pushToast(t('idView.didCopied'), 'success');
  };

  const onZkSettings = (): void => {
    router.push('/id/zk-settings');
  };

  const onOidc = (): void => {
    router.push('/scan');
  };

  const onRefresh = (): void => {
    // TODO(android): IdentityCoordinator.refreshIdentity()
    pushToast(t('idView.refreshPending'), 'info');
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onZk={onZkSettings} onOidc={onOidc} onRefresh={onRefresh} t={t} />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        <View>
          {/* 1. The Mask */}
          <View style={{ paddingTop: 20, paddingBottom: 40 }}>
            <MaskSection
              did={did}
              isDidKeyActive={isDidKeyActive}
              onSwitch={onSwitchDid}
              onCopyDid={() => {
                void onCopyDid();
              }}
              t={t}
            />
          </View>

          {/* 2. The Core */}
          <View style={{ height: 320, alignItems: 'center', justifyContent: 'center' }}>
            <RippleButton
              state={rippleState}
              commitment={commitment ?? undefined}
              onTap={onCoreTap}
              onLongPress={onCoreLongPress}
            />
          </View>

          {/* Spacer */}
          <View style={{ height: 40 }} />

          {/* 3. The Badge */}
          {developerMode ? (
            <BadgeSection
              groups={groups}
              onAdd={() => {
                router.push('/groups/new');
              }}
              onSelectGroup={(g) => {
                router.push({ pathname: '/groups/[id]', params: { id: g.id } });
              }}
              t={t}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function NavBar({
  onZk,
  onOidc,
  onRefresh,
  t,
}: {
  readonly onZk: () => void;
  readonly onOidc: () => void;
  readonly onRefresh: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between px-4" style={{ height: 44 }}>
      <PressableScale
        onPress={onZk}
        accessibilityRole="button"
        accessibilityLabel={t('idView.zkSettings')}
        style={{
          width: 44,
          height: 44,
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}>
        <SfIcon name="gearshape" size={18} color={Colors.text1} />
      </PressableScale>

      <ThemedText variant="titleMedium">{t('idView.title')}</ThemedText>

      <View className="flex-row items-center" style={{ gap: 12, height: 44 }}>
        <PressableScale
          onPress={onOidc}
          accessibilityRole="button"
          accessibilityLabel={t('idView.scan')}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="qrcode" size={18} color={Colors.text1} />
        </PressableScale>
        <PressableScale
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel={t('idView.refresh')}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="arrow.clockwise" size={18} color={Colors.text1} />
        </PressableScale>
      </View>
    </View>
  );
}

function MaskSection({
  did,
  isDidKeyActive,
  onSwitch,
  onCopyDid,
  t,
}: {
  readonly did: string | null;
  readonly isDidKeyActive: boolean;
  readonly onSwitch: () => void;
  readonly onCopyDid: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <ThemedSurface variant="card" className="flex-row rounded-none p-1">
        <DidCapsule
          title={t('idView.anonymous')}
          subtitle="did:key"
          isActive={isDidKeyActive}
          onPress={onSwitch}
        />
      </ThemedSurface>

      {did ? (
        <PressableScale
          onPress={onCopyDid}
          accessibilityRole="button"
          accessibilityLabel={`${t('idView.copyDid')} ${did}`}>
          <ThemedSurface
            variant="outlined"
            className="flex-row items-center gap-1.5 rounded-none px-2.5 py-1">
            <ThemedText variant="caption" tone="secondary" style={{ fontFamily: 'Menlo' }}>
              {shortDid(did)}
            </ThemedText>
            <SfIcon name="doc.on.doc" size={10} color={Colors.text2} />
          </ThemedSurface>
        </PressableScale>
      ) : null}
    </View>
  );
}

function BadgeSection({
  groups,
  onAdd,
  onSelectGroup,
  t,
}: {
  readonly groups: readonly GroupManifestEntry[];
  readonly onAdd: () => void;
  readonly onSelectGroup: (g: GroupManifestEntry) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <ThemedText variant="titleMedium" tone="secondary" style={{ paddingLeft: 24 }}>
          {t('idView.groups')}
        </ThemedText>
        <PressableScale
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={t('idView.createGroup')}
          hitSlop={8}
          style={{ paddingRight: 24 }}>
          <SfIcon name="plus.circle.fill" size={22} color={Colors.accentRose} />
        </PressableScale>
      </View>

      {groups.length === 0 ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <ThemedText variant="bodyMedium" tone="secondary">
            {t('idView.noGroups')}
          </ThemedText>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {groups.map((g) => (
            <BadgeGroupRow
              key={g.id}
              name={g.name}
              memberCount={g.memberCount ?? 0}
              // `isSynced` is intentionally not in the manifest — the
              // CloudKit pill only renders after `hydrate()` warms the full
              // record (which happens for the detail screen anyway).
              onPress={() => {
                onSelectGroup(g);
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
