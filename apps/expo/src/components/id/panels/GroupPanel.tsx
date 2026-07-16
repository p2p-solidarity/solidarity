/**
 * GroupPanel — list-of-groups + actions block that backs both
 * `app/id/groups.tsx` (standalone screen) and the Group tab inside
 * `app/id/dashboard.tsx`. Mirrors the body of Swift GroupIdentityView
 * (solidarity/Views/IDViews/GroupIdentityView.swift).
 *
 * Groups are local-only (MMKV, no cloud sync) — see
 * `docs/ref/01-spec-verified-page.md` §9. Joining a remote group by
 * invite link required CloudKit / Drive sync, which has been removed.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { IDSectionHeader } from '@/components/id';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useGroupManifest, useGroupStore, type GroupManifestEntry } from '@/groups/store';

const MONO_FONT = 'Menlo';

export function GroupPanel(): ReactNode {
  // Frame-1 list comes from the plaintext manifest (id/name/memberCount);
  // hydrate kicks off in the background so detail navigation has the full
  // record cached by the time the user taps a row.
  const seedFromManifest = useGroupStore((s) => s.seedFromManifest);
  const hydrate = useGroupStore((s) => s.hydrate);
  const groups = useGroupManifest();

  useEffect(() => {
    seedFromManifest();
    void hydrate();
  }, [seedFromManifest, hydrate]);

  const onRefresh = (): void => {
    pushToast('Group refresh lands next iteration', 'info');
    void hydrate();
  };

  const onSelect = (g: GroupManifestEntry): void => {
    router.push({ pathname: '/groups/[id]', params: { id: g.id } });
  };

  return (
    <View className="gap-4">
      <View>
        <View className="pb-2">
          <IDSectionHeader title="SELECTED GROUP" />
        </View>
        <View style={{ borderWidth: 1, borderColor: Colors.divider }} className="overflow-hidden">
          {groups.length === 0 ? (
            <ThemedSurface
              variant="inset"
              className="rounded-none"
              style={{ padding: 16, alignItems: 'flex-start' }}>
              <ThemedText variant="bodySmall" tone="secondary">
                No groups found. Create or join a group.
              </ThemedText>
            </ThemedSurface>
          ) : (
            groups.map((g, idx) => (
              <View key={g.id}>
                <PressableScale
                  onPress={() => {
                    onSelect(g);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={g.name}>
                  <ThemedSurface variant="inset" className="rounded-none" style={{ padding: 16 }}>
                    <ThemedText variant="label">{g.name}</ThemedText>
                    <ThemedText
                      variant="caption"
                      tone="secondary"
                      style={{ fontFamily: MONO_FONT }}
                      className="mt-1">
                      {`Members: ${String(g.memberCount ?? 0)}`}
                    </ThemedText>
                  </ThemedSurface>
                </PressableScale>
                {idx !== groups.length - 1 ? (
                  <View style={{ height: 1, backgroundColor: Colors.divider }} />
                ) : null}
              </View>
            ))
          )}
        </View>
      </View>

      <View>
        <View className="pb-2">
          <IDSectionHeader title="MEMBERS DETAILS" />
        </View>
        <ThemedSurface
          variant="inset"
          className="rounded-none"
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: Colors.divider,
          }}>
          <ThemedText variant="bodySmall" tone="secondary">
            Open a group to view its members.
          </ThemedText>
        </ThemedSurface>
      </View>

      <View>
        <View className="pb-2">
          <IDSectionHeader title="ACTIONS" />
        </View>
        <View className="gap-3">
          <ThemedButton
            variant="secondary"
            label="Refresh Groups"
            fullWidth
            leadingIcon={<SfIcon name="arrow.clockwise" size={14} color={Colors.accentRose} />}
            onPress={onRefresh}
          />
        </View>
      </View>
    </View>
  );
}
