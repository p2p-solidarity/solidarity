/**
 * DAG Lab — append-only sandbox event chain inspector, signing tool,
 * verifier, and replay viewer. Per docs §3.2.
 *
 * Operates against the shared `getDagStore()` singleton (MMKV-backed)
 * so nodes appended here show up in Identity Tree, P2P Lab "Mine", and
 * Nostr Bridge HEAD publication. One persistent store across screens.
 *
 * Capabilities:
 *   - Local HEAD list inspector
 *   - "Append test node" (kind=1063, action="dev.test", parents = current HEADs)
 *   - "Verify all signatures" — walks every persisted node, reports OK / invalid
 *   - "Replay state" — runs the §6.3 LWW projection, surfaces a summary
 *   - Export to clipboard (JSON), import from clipboard
 *   - "Clear all" (Lab reset)
 *
 * Tap a node to expand the raw JSON inspector. Tap the trash to revoke
 * (appends a `revoked` node referencing it).
 */
import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DagGraph3D } from '@/components/sandbox/DagGraph3D';
import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { loadOrCreateDevKey } from '@/dag/devKey';
import { getDagStore } from '@/dag/instance';
import {
  KIND_DAG_NODE,
  type DagNode,
  type DagNodeUnsigned,
  signNode,
  verifyNode,
} from '@/dag/node';
import { replay, type DagProjection } from '@/dag/replay';
import { confirmDialog } from '@/feedback/confirmDialog';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { usePreferences } from '@/settings/preferences';

interface VerificationReport {
  readonly ok: number;
  readonly bad: number;
  readonly badIds: readonly string[];
  readonly elapsedMs: number;
}

interface ReplaySummary {
  readonly exchanges: number;
  readonly attended: number;
  readonly presented: number;
  readonly joined: number;
  readonly revoked: number;
  readonly elapsedMs: number;
}

function summarize(p: DagProjection, elapsedMs: number): ReplaySummary {
  return {
    exchanges: p.exchangeByPeerDid.size,
    attended: p.attendedByEventId.size,
    presented: p.presentedByVerifierVc.size,
    joined: p.joinedByGroupId.size,
    revoked: p.revokedIds.size,
    elapsedMs,
  };
}

// Hoisted so the object identity is STABLE across renders. An inline
// `options={{ presentation: 'modal' }}` is a NEW object every render, so
// expo-router re-runs its `setOptions` effect each render → re-render → new
// object → "Maximum update depth exceeded" (this screen re-renders after mount
// from its data effects). See apps/expo/CLAUDE.md "Error handling".
const MODAL_SCREEN_OPTIONS = { presentation: 'modal' } as const;

export default function DagLab() {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const developerMode = usePreferences((s) => s.developerMode);
  const [noteInput, setNoteInput] = useState('');
  const [nodes, setNodes] = useState<readonly DagNode[]>([]);
  const [heads, setHeads] = useState<readonly string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationReport | null>(null);
  const [replaySummary, setReplaySummary] = useState<ReplaySummary | null>(null);
  const [localPubkey, setLocalPubkey] = useState<string>('');

  useEffect(() => {
    if (!developerMode) return;
    try {
      setLocalPubkey(loadOrCreateDevKey().pubkeyHex);
    } catch {
      setLocalPubkey('');
    }
  }, [developerMode]);

  const refresh = useCallback(() => {
    try {
      const store = getDagStore();
      setNodes(store.allNodes());
      setHeads(store.heads());
    } catch {
      setNodes([]);
      setHeads([]);
    }
  }, []);

  useEffect(() => {
    if (!developerMode) return;
    refresh();
  }, [developerMode, refresh]);

  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      if (a.created_at !== b.created_at) return b.created_at - a.created_at;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
  }, [nodes]);

  const appendTestNode = useCallback(() => {
    try {
      const { privkey, pubkeyHex } = loadOrCreateDevKey();
      const store = getDagStore();
      const unsigned: DagNodeUnsigned = {
        author: pubkeyHex,
        parents: store.heads(),
        kind: KIND_DAG_NODE,
        action: 'dev.test',
        payload: { note: noteInput || `test #${String(store.count() + 1)}` },
        created_at: Math.floor(Date.now() / 1000),
      };
      const node = signNode(unsigned, privkey);
      const result = store.appendNode(node);
      if (result.kind === 'invalid') {
        pushToast(`Append rejected: ${result.reason}`, 'error', 3000);
        haptic('error');
      } else {
        pushToast(`${result.kind}: ${node.id.slice(0, 12)}…`, 'success', 2000);
        haptic('success');
        setNoteInput('');
      }
      refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Append failed', 'error', 3000);
      haptic('error');
    }
  }, [noteInput, refresh]);

  const revokeNode = useCallback((targetId: string) => {
    void (async () => {
      const ok = await confirmDialog({
        title: 'Revoke node?',
        message: `Appends a "revoked" node referencing ${targetId.slice(0, 12)}…. Replay will skip it; the raw node stays in the store.`,
        confirmLabel: 'Revoke',
        destructive: true,
      });
      if (!ok) return;
      try {
        const { privkey, pubkeyHex } = loadOrCreateDevKey();
        const store = getDagStore();
        const unsigned: DagNodeUnsigned = {
          author: pubkeyHex,
          parents: [targetId],
          kind: KIND_DAG_NODE,
          action: 'revoked',
          payload: { revokes_id: targetId },
          created_at: Math.floor(Date.now() / 1000),
        };
        const node = signNode(unsigned, privkey);
        store.appendNode(node);
        pushToast('Revocation appended', 'success', 2000);
        haptic('success');
        refresh();
        setReplaySummary(null); // stale
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Revoke failed', 'error', 3000);
        haptic('error');
      }
    })();
  }, [refresh]);

  const verifyAll = useCallback(() => {
    const t0 = performance.now();
    let ok = 0;
    const bad: string[] = [];
    for (const node of nodes) {
      if (verifyNode(node)) ok++;
      else bad.push(node.id);
    }
    const elapsed = performance.now() - t0;
    setVerification({ ok, bad: bad.length, badIds: bad, elapsedMs: elapsed });
    if (bad.length === 0) {
      pushToast(`Verified ${String(ok)} nodes in ${elapsed.toFixed(0)}ms`, 'success', 2500);
      haptic('success');
    } else {
      pushToast(`${String(bad.length)} bad signatures found`, 'warning', 3000);
      haptic('warning');
    }
  }, [nodes]);

  const runReplay = useCallback(() => {
    const t0 = performance.now();
    const projection = replay(nodes);
    const elapsed = performance.now() - t0;
    setReplaySummary(summarize(projection, elapsed));
    pushToast(`Replayed ${String(nodes.length)} nodes in ${elapsed.toFixed(0)}ms`, 'info', 2500);
  }, [nodes]);

  const exportDag = useCallback(async () => {
    try {
      const payload = JSON.stringify({ v: 1, exported_at: Date.now(), nodes }, null, 2);
      await Clipboard.setStringAsync(payload);
      pushToast(`Copied ${String(nodes.length)} nodes (${String(payload.length)} chars)`, 'success', 2500);
      haptic('success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Export failed', 'error', 3000);
      haptic('error');
    }
  }, [nodes]);

  const importDag = useCallback(async () => {
    try {
      const raw = await Clipboard.getStringAsync();
      if (!raw) {
        pushToast('Clipboard empty', 'warning', 2000);
        return;
      }
      const parsed = JSON.parse(raw) as { nodes?: readonly DagNode[] };
      const incoming = Array.isArray(parsed.nodes) ? parsed.nodes : Array.isArray(parsed) ? (parsed as unknown as readonly DagNode[]) : null;
      if (!incoming) {
        pushToast('Bad import: expected { nodes: [...] }', 'error', 3000);
        return;
      }
      const store = getDagStore();
      let inserted = 0, duplicate = 0, invalid = 0;
      for (const node of incoming) {
        const result = store.appendNode(node);
        if (result.kind === 'inserted') inserted++;
        else if (result.kind === 'duplicate') duplicate++;
        else invalid++;
      }
      pushToast(`Imported · +${String(inserted)} dup ${String(duplicate)} bad ${String(invalid)}`, 'success', 3000);
      haptic('success');
      refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Import failed', 'error', 3000);
      haptic('error');
    }
  }, [refresh]);

  const clearAll = useCallback(() => {
    void (async () => {
      const ok = await confirmDialog({
        title: 'Clear DAG?',
        message:
          'Wipes every node and the HEAD set. The sandbox secp256k1 key survives — use Reset sandbox key in P2P Lab to regenerate that too.',
        confirmLabel: 'Clear',
        destructive: true,
      });
      if (!ok) return;
      try {
        getDagStore().clear();
        setVerification(null);
        setReplaySummary(null);
        refresh();
        pushToast('DAG cleared', 'success', 2000);
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Clear failed', 'error', 3000);
      }
    })();
  }, [refresh]);

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
        <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
        <SettingsScreenTitle title="DAG Lab" />
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
      <SettingsScreenTitle title="DAG Lab" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              {`Append-only event chain. ${String(nodes.length)} node${nodes.length === 1 ? '' : 's'} · ${String(heads.length)} HEAD${heads.length === 1 ? '' : 's'}. Persistent across restarts (MMKV).`}
            </Text>
          </View>

          <View className="px-4">
            <DagGraph3D
              nodes={nodes}
              heads={heads}
              width={screen.width - 32}
              height={300}
              localAuthorPubkey={localPubkey}
              onSelectNode={(id) => { setExpandedId(id); }}
            />
          </View>

          <SettingsBlockSection
            title="Append test node"
            footer="kind=1063 (NIP-94-adjacent immutable). action='dev.test'. parents = current HEADs. Signed by the sandbox secp256k1 key, persisted in MMKV."
          >
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <TextInput
                value={noteInput}
                onChangeText={setNoteInput}
                placeholder={`note (defaults to "test #${String(nodes.length + 1)}")`}
                placeholderTextColor={Colors.text3}
                style={{ color: Colors.text1, fontSize: 13, fontFamily: 'Menlo' }}
              />
            </View>
            <SettingsBlockRow
              icon="plus.square"
              title="Append"
              subtitle={`Will reference ${String(heads.length)} parent${heads.length === 1 ? '' : 's'}`}
              onPress={appendTestNode}
            />
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Inspect"
            footer={
              verification
                ? `Last verify: ${String(verification.ok)} ok · ${String(verification.bad)} bad · ${verification.elapsedMs.toFixed(0)}ms`
                : 'Verify walks every node, re-checks NIP-01 canonical id, then BIP-340 schnorr signature.'
            }
          >
            <SettingsBlockRow
              icon="checkmark.shield"
              title="Verify all signatures"
              onPress={verifyAll}
            />
            <SettingsBlockRow
              icon="arrow.triangle.2.circlepath"
              title="Replay projection"
              subtitle={
                replaySummary
                  ? `${String(replaySummary.exchanges)} exch · ${String(replaySummary.attended)} attd · ${String(replaySummary.presented)} pres · ${String(replaySummary.joined)} grp · ${String(replaySummary.revoked)} rev · ${replaySummary.elapsedMs.toFixed(0)}ms`
                  : 'Builds the LWW projection from current nodes'
              }
              onPress={runReplay}
            />
          </SettingsBlockSection>

          <SettingsBlockSection
            title="Export / Import"
            footer="Export copies JSON to clipboard. Import reads clipboard and appends each node — duplicates skipped, invalid signatures rejected."
          >
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title="Export to clipboard"
              onPress={() => { void exportDag(); }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.down"
              title="Import from clipboard"
              onPress={() => { void importDag(); }}
            />
            <SettingsBlockRow
              icon="trash"
              title="Clear all nodes"
              onPress={clearAll}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`HEADs (${String(heads.length)})`}
              </Text>
            </View>
            <View className="px-4 gap-1">
              {heads.length === 0 ? (
                <Text className="text-text3 text-[12px]">No HEADs.</Text>
              ) : (
                heads.map((h) => (
                  <View
                    key={h}
                    className="bg-mutedSurface rounded-md"
                    style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text
                      className="text-text1 text-[11px]"
                      style={{ fontFamily: 'Menlo' }}
                      selectable
                      numberOfLines={1}
                    >
                      {h}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

          <View className="gap-3">
            <View className="px-4">
              <Text className="text-text1 text-[14px]">
                {`Nodes (newest first, ${String(sortedNodes.length)})`}
              </Text>
            </View>
            <View className="px-4 gap-2">
              {sortedNodes.length === 0 ? (
                <Text className="text-text3 text-[12px]">No nodes yet.</Text>
              ) : (
                sortedNodes.map((node) => {
                  const expanded = expandedId === node.id;
                  const isHead = heads.includes(node.id);
                  return (
                    <View
                      key={node.id}
                      className="bg-mutedSurface rounded-xl"
                      style={{ paddingHorizontal: 14, paddingVertical: 12 }}
                    >
                      <Pressable
                        onPress={() => { setExpandedId(expanded ? null : node.id); }}
                        accessibilityRole="button"
                      >
                        <View className="flex-row items-center" style={{ marginBottom: 4 }}>
                          <Text
                            className="text-text1 text-[13px] font-semibold"
                            style={{ fontFamily: 'Menlo', flex: 1 }}
                            numberOfLines={1}
                          >
                            {`${node.action} · ${node.id.slice(0, 12)}…`}
                          </Text>
                          {isHead ? (
                            <Text
                              className="text-text2 text-[10px]"
                              style={{ marginLeft: 8 }}
                            >
                              HEAD
                            </Text>
                          ) : null}
                        </View>
                        <Text className="text-text3 text-[11px]">
                          {`kind ${String(node.kind)} · parents ${String(node.parents.length)} · ${new Date(node.created_at * 1000).toISOString().slice(0, 19).replace('T', ' ')}`}
                        </Text>
                        {expanded ? (
                          <>
                            <Text
                              className="text-text2 text-[10px]"
                              style={{ fontFamily: 'Menlo', marginTop: 8 }}
                              selectable
                            >
                              {JSON.stringify(node, null, 2)}
                            </Text>
                            <Pressable
                              onPress={() => { revokeNode(node.id); }}
                              accessibilityRole="button"
                              style={{ marginTop: 10, alignSelf: 'flex-start' }}
                              className="active:opacity-70"
                            >
                              <Text
                                style={{
                                  color: Colors.destructive,
                                  fontSize: 12,
                                  fontWeight: '600',
                                }}
                              >
                                Revoke this node
                              </Text>
                            </Pressable>
                          </>
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          {verification && verification.bad > 0 ? (
            <View className="px-4">
              <Text className="text-text1 text-[14px]" style={{ marginBottom: 8 }}>
                Invalid signatures
              </Text>
              {verification.badIds.map((id) => (
                <Text
                  key={id}
                  className="text-text2 text-[11px]"
                  style={{ fontFamily: 'Menlo' }}
                  selectable
                  numberOfLines={1}
                >
                  {id}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
