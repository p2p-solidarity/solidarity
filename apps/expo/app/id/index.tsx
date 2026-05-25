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
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BadgeGroupRow,
  DidCapsule,
  RippleButton,
  shortDid,
  type RippleButtonState,
} from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import {
  useGroupManifest,
  useGroupStore,
  type GroupManifestEntry,
} from '@/groups/store';
import { usePreferences } from '@/settings/preferences';
import { useIdentitySnapshot, useZkIdentity } from '@/zk';

export default function IDViewScreen(): React.JSX.Element {
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
        .then(() => { haptic('success'); })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          pushToast(`Identity creation failed: ${message}`, 'warning');
        })
        .finally(() => { setIsWorkingLocal(false); });
    } else {
      // TODO(android): IdentityCoordinator.refreshIdentity() — full refresh
      // sweep (DID metadata, group root pulls) lands in a follow-up iteration;
      // for now the ZK identity itself is already authoritative.
      pushToast('Identity is up to date', 'info');
    }
  };

  const onCoreLongPress = (): void => {
    // Swift presents the GroupManagementView sheet.
    router.push('/settings/groups');
  };

  const onSwitchDid = (): void => {
    // did:key is currently the only supported method; capsule kept for
    // visual parity with Swift but no-ops on press.
    pushToast('did:key is the only supported method', 'info');
  };

  const onCopyDid = async (): Promise<void> => {
    if (!did) return;
    await Clipboard.setStringAsync(did);
    haptic('selection');
    pushToast('DID copied', 'success');
  };

  const onZkSettings = (): void => {
    router.push('/id/zk-settings');
  };

  const onOidc = (): void => {
    router.push('/scan');
  };

  const onRefresh = (): void => {
    // TODO(android): IdentityCoordinator.refreshIdentity()
    pushToast('Identity refresh lands next iteration', 'info');
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onZk={onZkSettings} onOidc={onOidc} onRefresh={onRefresh} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View>
          {/* 1. The Mask */}
          <View style={{ paddingTop: 20, paddingBottom: 40 }}>
            <MaskSection
              did={did}
              isDidKeyActive={isDidKeyActive}
              onSwitch={onSwitchDid}
              onCopyDid={() => { void onCopyDid(); }}
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
              onAdd={() => { router.push('/groups/new'); }}
              onSelectGroup={(g) => {
                router.push({ pathname: '/groups/[id]', params: { id: g.id } });
              }}
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
}: {
  readonly onZk: () => void;
  readonly onOidc: () => void;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{ height: 44 }}
    >
      <Pressable
        onPress={onZk}
        accessibilityRole="button"
        accessibilityLabel="ZK Settings"
        style={{
          width: 44,
          height: 44,
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
        className="active:opacity-60"
      >
        <SfIcon name="gearshape" size={18} color={Colors.text1} />
      </Pressable>

      <Text className="text-text1 text-[17px] font-semibold">ID</Text>

      <View
        className="flex-row items-center"
        style={{ gap: 12, height: 44 }}
      >
        <Pressable
          onPress={onOidc}
          accessibilityRole="button"
          accessibilityLabel="Scan"
          hitSlop={8}
          className="active:opacity-60"
        >
          <SfIcon name="qrcode" size={18} color={Colors.text1} />
        </Pressable>
        <Pressable
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          hitSlop={8}
          className="active:opacity-60"
        >
          <SfIcon name="arrow.clockwise" size={18} color={Colors.text1} />
        </Pressable>
      </View>
    </View>
  );
}

function MaskSection({
  did,
  isDidKeyActive,
  onSwitch,
  onCopyDid,
}: {
  readonly did: string | null;
  readonly isDidKeyActive: boolean;
  readonly onSwitch: () => void;
  readonly onCopyDid: () => void;
}): React.JSX.Element {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: Colors.cardBg,
          borderRadius: 30,
          padding: 4,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 2 },
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      >
        <DidCapsule
          title="Anonymous"
          subtitle="did:key"
          isActive={isDidKeyActive}
          onPress={onSwitch}
        />
      </View>

      {did ? (
        <Pressable
          onPress={onCopyDid}
          accessibilityRole="button"
          accessibilityLabel={`Copy DID ${did}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: Colors.cardBg,
            borderWidth: 1,
            borderColor: Colors.divider,
          }}
          className="active:opacity-60"
        >
          <Text
            style={{ fontFamily: 'Menlo', color: Colors.text2, fontSize: 11 }}
          >
            {shortDid(did)}
          </Text>
          <SfIcon name="doc.on.doc" size={10} color={`${Colors.text2}B3`} />
        </Pressable>
      ) : null}
    </View>
  );
}

function BadgeSection({
  groups,
  onAdd,
  onSelectGroup,
}: {
  readonly groups: readonly GroupManifestEntry[];
  readonly onAdd: () => void;
  readonly onSelectGroup: (g: GroupManifestEntry) => void;
}): React.JSX.Element {
  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          className="text-text2 text-[17px] font-semibold"
          style={{ paddingLeft: 24 }}
        >
          Groups
        </Text>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Create group"
          hitSlop={8}
          style={{ paddingRight: 24 }}
          className="active:opacity-60"
        >
          <SfIcon
            name="plus.circle.fill"
            size={22}
            color={Colors.accentRose}
          />
        </Pressable>
      </View>

      {groups.length === 0 ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <Text className="text-text2 text-[15px]">No group memberships</Text>
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
              onPress={() => { onSelectGroup(g); }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
