/**
 * 證據包 (Evidence Pack) — mock v3 `pg-pack`: pick claims, watch the live
 * CRD1 character budget, mint ONE offline-verifiable QR (no PDF).
 *
 * Wire: CBOR → COSE_Sign1 → zlib → Base45, `CRD1:` prefix, EC level Q,
 * ≤2,420 chars, 30-day validity (CREDS.md §18). Signed under the profile's
 * root did:key via the Face-ID-gated root signer.
 *
 * Honesty: rows are `verified` only from a completed badge-cache check;
 * links ship as `declared`. No server countersignature, no transparency-log
 * position — the app has neither.
 */
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sha256Bytes } from '@solidarity/shared';

import {
  readCachedAtprotoResult,
  readCachedNostrResult,
  warmBadgeStatusCache,
  type CachedBadgeResult,
} from '@/badges/badgeStatusCache';
import {
  buildEvidencePackRows,
  estimateEvidencePack,
  signEvidencePack,
  type EvidencePackRow,
  type EvidencePackSource,
} from '@/cards/evidencePack';
import { generateQrPng } from '@/cards/qrCodeManager';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { getRootSigner } from '@/identity/rootKey';
import { safeBack } from '@/navigation/safeBack';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';
import type {
  VerifyAtprotoBindingResult,
  VerifyNostrBindingResult,
} from '@solidarity/shared';

type PackState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'generating' }
  | {
      readonly kind: 'ready';
      readonly uri: string;
      readonly chars: number;
      readonly qrVersion: number;
      readonly generatedAt: Date;
    }
  | { readonly kind: 'error'; readonly message: string };

interface BindingCaches {
  readonly nostr: CachedBadgeResult<VerifyNostrBindingResult> | null;
  readonly atproto: CachedBadgeResult<VerifyAtprotoBindingResult> | null;
}

const QR_SIZE = 232;

export default function EvidencePackScreen(): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const record = useProfileStore((state) => state.record);
  const profileStatus = useProfileStore((state) => state.status);
  const username = usePreferences((state) => state.publicPageUsername);

  const [caches, setCaches] = useState<BindingCaches>({ nostr: null, atproto: null });
  useEffect(() => {
    let cancelled = false;
    void warmBadgeStatusCache().then(() => {
      if (cancelled) return;
      setCaches({ nostr: readCachedNostrResult(), atproto: readCachedAtprotoResult() });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const source: EvidencePackSource | null = useMemo(() => {
    if (!record) return null;
    return {
      record,
      username: username.length > 0 ? username : null,
      nostr: caches.nostr,
      atproto: caches.atproto,
    };
  }, [caches.atproto, caches.nostr, record, username]);

  const rows = useMemo(() => (source ? buildEvidencePackRows(source) : []), [source]);
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const selectedRows = useMemo(
    () => rows.filter((row) => !deselected.has(row.id)),
    [deselected, rows]
  );

  const estimate = useMemo(
    () => (source ? estimateEvidencePack(source, selectedRows) : null),
    [selectedRows, source]
  );

  const [pack, setPack] = useState<PackState>({ kind: 'idle' });

  const toggleRow = (id: string): void => {
    setPack({ kind: 'idle' });
    setDeselected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = async (): Promise<void> => {
    if (!source) return;
    setPack({ kind: 'generating' });
    const signerResult = await getRootSigner();
    if (!signerResult.ok) {
      setPack({ kind: 'error', message: t('evidencePack.signDenied') });
      return;
    }
    const rootSigner = signerResult.value;
    try {
      const outcome = await signEvidencePack(source, selectedRows, (message) =>
        rootSigner(sha256Bytes(message))
      );
      if (!outcome.ok) {
        setPack({ kind: 'error', message: t('evidencePack.overCapacity', { chars: outcome.chars }) });
        return;
      }
      const uri = await generateQrPng(outcome.wire, { size: QR_SIZE, startingLevel: 'Q' });
      setPack({
        kind: 'ready',
        uri,
        chars: outcome.chars,
        qrVersion: outcome.qrVersion,
        generatedAt: new Date(),
      });
    } catch {
      setPack({ kind: 'error', message: t('evidencePack.signDenied') });
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('evidencePack.backTitle')} onPress={() => { safeBack(); }} />
      <SettingsScreenTitle title={t('evidencePack.title')} />
      {profileStatus !== 'ready' || !source ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <ThemedText variant="titleMedium">{t('evidencePack.noPageTitle')}</ThemedText>
          <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
            {t('evidencePack.noPageBody')}
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16, gap: 16 }}>
          <ThemedText variant="bodyMedium" tone="secondary">
            {t('evidencePack.explainer')}
          </ThemedText>

          <ThemedSurface variant="outlined" className="rounded-none">
            <IdentityRow
              name={source.record.displayName}
              username={source.username}
              did={source.record.did}
            />
            {rows.map((row) => (
              <View key={row.id}>
                <View style={{ height: 0.5, backgroundColor: Colors.divider }} />
                <ClaimRow
                  row={row}
                  selected={!deselected.has(row.id)}
                  onToggle={() => {
                    toggleRow(row.id);
                  }}
                />
              </View>
            ))}
          </ThemedSurface>

          {estimate ? (
            estimate.ok ? (
              <ThemedText variant="caption" tone="tertiary" style={{ fontFamily: 'Menlo' }}>
                {t('evidencePack.sizeLine', {
                  chars: estimate.chars,
                  version: estimate.qrVersion,
                })}
              </ThemedText>
            ) : (
              <ThemedText variant="caption" style={{ color: Colors.warningText, fontFamily: 'Menlo' }}>
                {t('evidencePack.overCapacity', { chars: estimate.chars })}
              </ThemedText>
            )
          ) : null}

          <ThemedButton
            label={
              pack.kind === 'ready' ? t('evidencePack.regenerate') : t('evidencePack.generate')
            }
            variant="primary"
            fullWidth
            loading={pack.kind === 'generating'}
            disabled={pack.kind === 'generating' || !estimate?.ok}
            onPress={() => {
              void generate();
            }}
          />

          {pack.kind === 'error' ? (
            <ThemedText variant="bodySmall" style={{ color: Colors.destructiveText }}>
              {pack.message}
            </ThemedText>
          ) : null}

          {pack.kind === 'ready' ? (
            <ThemedSurface variant="outlined" className="items-center gap-2 rounded-none p-4">
              {/* The generated SVG carries its own white module background —
                  the wrapper stays on the card token in both themes. */}
              <View style={{ backgroundColor: Colors.cardBg, padding: 8 }}>
                <Image
                  source={{ uri: pack.uri }}
                  style={{ width: QR_SIZE, height: QR_SIZE }}
                  contentFit="contain"
                  accessibilityLabel={t('evidencePack.qrLabel')}
                />
              </View>
              <ThemedText variant="caption" tone="tertiary" style={{ fontFamily: 'Menlo' }}>
                {t('evidencePack.metaLine', { chars: pack.chars, version: pack.qrVersion })}
              </ThemedText>
              <ThemedText variant="caption" tone="tertiary">
                {t('evidencePack.validity')} ·{' '}
                {t('evidencePack.generatedAt', {
                  time: pack.generatedAt.toLocaleString(),
                })}
              </ThemedText>
            </ThemedSurface>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function IdentityRow({
  name,
  username,
  did,
}: {
  readonly name: string;
  readonly username: string | null;
  readonly did: string;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ minHeight: 56, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 2 }}>
      <ThemedText variant="bodyMedium">
        {name}
        {username ? `  @${username}` : ''}
      </ThemedText>
      <ThemedText variant="caption" tone="tertiary" numberOfLines={1} style={{ fontFamily: 'Menlo' }}>
        {did}
      </ThemedText>
      <ThemedText variant="caption" tone="tertiary">
        {t('evidencePack.identityAlwaysIncluded')}
      </ThemedText>
    </View>
  );
}

function ClaimRow({
  row,
  selected,
  onToggle,
}: {
  readonly row: EvidencePackRow;
  readonly selected: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const verified = row.status === 'verified';
  return (
    <PressableScale
      haptic="tap"
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={row.label}
      style={{
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}>
      <SfIcon
        name={selected ? 'checkmark.square.fill' : 'square'}
        size={18}
        color={selected ? Colors.primaryBlue : Colors.text3}
      />
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodyMedium" numberOfLines={1}>
          {row.label}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {row.value}
        </ThemedText>
      </View>
      <ThemedText
        variant="caption"
        style={{ color: verified ? Colors.terminalGreenText : Colors.text2 }}>
        {verified ? t('evidencePack.statusVerified') : t('evidencePack.statusDeclared')}
      </ThemedText>
    </PressableScale>
  );
}
