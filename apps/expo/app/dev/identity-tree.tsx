/**
 * Identity Tree Lab — read-only projection of every state the active
 * DID is the root of. Per docs §3.1 + §1 (DID-first first principle).
 *
 * Branches:
 *   - Cards I hold      ← useCredentialStore.manifest  → /credentials/[id]
 *   - Contacts I've met ← useContactList()             → /people/[id]
 *   - Groups I've joined← useAllGroups()               → /groups/[id]
 *   - DAG events        ← getDagStore().allNodes()     → expand inline JSON
 *
 * No new data. No mutations. Tap a leaf → opens the existing public
 * screen for that entity. Adding an "edit" button here would violate
 * the docs §3.1 anti-pattern note.
 *
 * Two DID roots are displayed side-by-side so the dev never confuses
 * them: the production Spruce DID (canonical identity for VC holds /
 * exchanges) and the sandbox secp256k1 dev-key (only signs DAG nodes).
 */
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useContactList } from '@/contacts/repository';
import { useCredentialStore } from '@/credentials/store';
import { loadOrCreateDevKey } from '@/dag/devKey';
import { getDagStore } from '@/dag/instance';
import type { DagNode } from '@/dag/node';
import { useAllGroups } from '@/groups/store';
import { useActiveDid, useIdentityCoordinator } from '@/identity';
import { usePreferences } from '@/settings/preferences';

const DAG_PREVIEW_MAX = 10;

// Hoisted to a stable ref — inline `options={{ presentation: 'modal' }}` is a
// new object each render → expo-router setOptions loop → "Maximum update depth".
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;

export default function IdentityTreeLab() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  const activeDid = useActiveDid();
  const credentials = useCredentialStore((s) => s.manifest);
  const seedCredentials = useCredentialStore((s) => s.seedFromManifest);
  const contacts = useContactList();
  const groups = useAllGroups();
  const [devPubkey, setDevPubkey] = useState<string>('');
  const [dagNodes, setDagNodes] = useState<readonly DagNode[]>([]);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  useEffect(() => {
    void seedKeychain();
    seedCredentials();
  }, [seedKeychain, seedCredentials]);

  useEffect(() => {
    if (!developerMode) return;
    try {
      setDevPubkey(loadOrCreateDevKey().pubkeyHex);
    } catch {
      setDevPubkey('');
    }
    try {
      setDagNodes(getDagStore().allNodes());
    } catch {
      setDagNodes([]);
    }
  }, [developerMode]);

  const dagAuthoredByDevKey = useMemo(
    () => (devPubkey ? dagNodes.filter((n) => n.author === devPubkey) : []),
    [dagNodes, devPubkey]
  );

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title="Identity Tree" />
        <View className="px-4 pt-6">
          <Text className="text-text2 text-[13px]">
            Sandbox is gated by Developer Mode. Toggle it in Settings ▸ Developer first.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Identity Tree" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              Read-only projection. Every leaf links into the existing public screen — adding a mutation surface here would violate docs §3.1.
            </Text>
          </View>

          <SettingsBlockSection
            title="Roots"
            footer="Spruce ed25519 is the canonical production identity (holds VCs, signs OIDC). Sandbox secp256k1 only signs DAG nodes — never linked to the Spruce DID on the public surface."
          >
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text className="text-text3 text-[11px]" style={{ marginBottom: 4 }}>
                ACTIVE DID (Spruce / ed25519)
              </Text>
              <Text
                className="text-text1 text-[11px]"
                style={{ fontFamily: 'Menlo' }}
                numberOfLines={2}
                selectable
              >
                {activeDid ?? '(none — set up identity from public Settings ▸ DIDs)'}
              </Text>
            </View>
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text className="text-text3 text-[11px]" style={{ marginBottom: 4 }}>
                SANDBOX KEY (secp256k1 · x-only)
              </Text>
              <Text
                className="text-text1 text-[11px]"
                style={{ fontFamily: 'Menlo' }}
                numberOfLines={2}
                selectable
              >
                {devPubkey || '(generating…)'}
              </Text>
            </View>
          </SettingsBlockSection>

          <View className="gap-3">
            <View className="px-4 flex-row items-center justify-between">
              <Text className="text-text1 text-[14px]">
                {`Cards I hold (${String(credentials.length)})`}
              </Text>
              <Pressable
                onPress={() => { router.push('/credentials'); }}
                accessibilityRole="button"
              >
                <Text className="text-text3 text-[12px]">Open list →</Text>
              </Pressable>
            </View>
            <View className="px-4 gap-2">
              {credentials.length === 0 ? (
                <EmptyRow label="No credentials held yet." />
              ) : (
                credentials.slice(0, 8).map((vc) => (
                  <SettingsBlockRow
                    key={vc.id}
                    icon="rectangle.stack.badge.person.crop"
                    title={vc.title || vc.type || 'Untitled credential'}
                    subtitle={`${vc.type} · ${vc.trustLevel}`}
                    onPress={() => { router.push(`/credentials/${vc.id}`); }}
                  />
                ))
              )}
              {credentials.length > 8 ? (
                <SettingsBlockRow
                  icon="ellipsis"
                  title={`+${String(credentials.length - 8)} more`}
                  onPress={() => { router.push('/credentials'); }}
                />
              ) : null}
            </View>
          </View>

          <View className="gap-3">
            <View className="px-4 flex-row items-center justify-between">
              <Text className="text-text1 text-[14px]">
                {`Contacts I've met (${String(contacts.length)})`}
              </Text>
              <Pressable
                onPress={() => { router.push('/(tabs)/people'); }}
                accessibilityRole="button"
              >
                <Text className="text-text3 text-[12px]">Open list →</Text>
              </Pressable>
            </View>
            <View className="px-4 gap-2">
              {contacts.length === 0 ? (
                <EmptyRow label="No contacts yet — exchange a card from Share." />
              ) : (
                contacts.slice(0, 8).map((c) => (
                  <SettingsBlockRow
                    key={c.id}
                    icon="person.crop.circle"
                    title={c.name || c.id}
                    subtitle={[c.company, c.title].filter(Boolean).join(' · ') || c.verificationStatus}
                    onPress={() => { router.push(`/people/${c.id}`); }}
                  />
                ))
              )}
              {contacts.length > 8 ? (
                <SettingsBlockRow
                  icon="ellipsis"
                  title={`+${String(contacts.length - 8)} more`}
                  onPress={() => { router.push('/(tabs)/people'); }}
                />
              ) : null}
            </View>
          </View>

          <View className="gap-3">
            <View className="px-4 flex-row items-center justify-between">
              <Text className="text-text1 text-[14px]">
                {`Groups I've joined (${String(groups.length)})`}
              </Text>
              <Pressable
                onPress={() => { router.push('/groups'); }}
                accessibilityRole="button"
              >
                <Text className="text-text3 text-[12px]">Open list →</Text>
              </Pressable>
            </View>
            <View className="px-4 gap-2">
              {groups.length === 0 ? (
                <EmptyRow label="No groups joined." />
              ) : (
                groups.slice(0, 8).map((g) => (
                  <SettingsBlockRow
                    key={g.id}
                    icon="person.3"
                    title={g.name || g.id}
                    subtitle={`${String(g.memberCount)} member${g.memberCount === 1 ? '' : 's'} · ${g.isPrivate ? 'private' : 'public'}`}
                    onPress={() => { router.push(`/groups/${g.id}`); }}
                  />
                ))
              )}
            </View>
          </View>

          <View className="gap-3">
            <View className="px-4 flex-row items-center justify-between">
              <Text className="text-text1 text-[14px]">
                {`DAG events I authored (${String(dagAuthoredByDevKey.length)})`}
              </Text>
              <Pressable
                onPress={() => { router.push('/dev/dag'); }}
                accessibilityRole="button"
              >
                <Text className="text-text3 text-[12px]">DAG Lab →</Text>
              </Pressable>
            </View>
            <View className="px-4 gap-2">
              {dagAuthoredByDevKey.length === 0 ? (
                <EmptyRow label="No DAG events yet — add one in DAG Lab or P2P Lab." />
              ) : (
                dagAuthoredByDevKey.slice(0, DAG_PREVIEW_MAX).map((node) => (
                  <View
                    key={node.id}
                    className="bg-mutedSurface rounded-xl"
                    style={{ paddingHorizontal: 14, paddingVertical: 12 }}
                  >
                    <Pressable
                      onPress={() => {
                        setExpandedNodeId(expandedNodeId === node.id ? null : node.id);
                      }}
                      accessibilityRole="button"
                    >
                      <View className="flex-row items-center" style={{ marginBottom: 4 }}>
                        <Text
                          className="text-text1 text-[13px] font-semibold"
                          style={{ fontFamily: 'Menlo', flex: 1 }}
                          numberOfLines={1}
                        >
                          {node.action} · {node.id.slice(0, 12)}…
                        </Text>
                        <Text className="text-text3 text-[11px]" style={{ marginLeft: 8 }}>
                          {new Date(node.created_at * 1000).toISOString().slice(0, 19).replace('T', ' ')}
                        </Text>
                      </View>
                      <Text className="text-text3 text-[11px]">
                        {`parents: ${String(node.parents.length)} · kind ${String(node.kind)}`}
                      </Text>
                      {expandedNodeId === node.id ? (
                        <Text
                          className="text-text2 text-[10px]"
                          style={{ fontFamily: 'Menlo', marginTop: 8 }}
                          selectable
                        >
                          {JSON.stringify(node, null, 2)}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                ))
              )}
              {dagAuthoredByDevKey.length > DAG_PREVIEW_MAX ? (
                <Text className="text-text3 text-[12px] px-2">
                  {`+${String(dagAuthoredByDevKey.length - DAG_PREVIEW_MAX)} more in DAG Lab`}
                </Text>
              ) : null}
            </View>
          </View>

          <View className="px-4 pt-4">
            <SettingsBlockSectionHeader title="DID-first reminder" />
            <Text
              className="text-text3 text-[12px]"
              style={{ marginTop: 8, color: Colors.text3 }}
            >
              Every leaf above is something this DID *already does* on the public surface — sandbox just gives a unified view rooted at the DID. No new identity primitive, no parallel profile, no separate account.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <View
      className="bg-mutedSurface rounded-xl"
      style={{ paddingHorizontal: 14, paddingVertical: 14 }}
    >
      <Text className="text-text2 text-[13px]">{label}</Text>
    </View>
  );
}
