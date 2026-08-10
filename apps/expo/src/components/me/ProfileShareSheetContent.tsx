import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

import type {
  HandleShareCandidate,
  ProfileShareModel,
  ProfileShareUrlCandidate,
} from './meProfileModel';
import { displayProfileShareUrl } from './meProfileModel';
import { profileShareQrIsOversize } from './profileShareQr';

export const PROFILE_SHARE_QR_SIZE = 208;

export type ProfileShareQrState =
  | { readonly kind: 'loading'; readonly url: string | null }
  | { readonly kind: 'ready'; readonly url: string; readonly uri: string }
  | { readonly kind: 'error'; readonly url: string }
  | { readonly kind: 'oversize'; readonly url: string };

export interface ReadyProfileShareModel {
  readonly kind: 'ready';
  readonly model: ProfileShareModel;
  readonly candidates: readonly ProfileShareUrlCandidate[];
  readonly selected: ProfileShareUrlCandidate;
  readonly verifiedHandle: HandleShareCandidate | null;
}

export function ProfileShareReadyContent({
  visible,
  state,
  qrState,
  onCopy,
  onShare,
  onShareQr,
  onSelectFormat,
  onRetryQr,
}: {
  readonly visible: boolean;
  readonly state: ReadyProfileShareModel;
  readonly qrState: ProfileShareQrState;
  readonly onCopy: (url: string) => void;
  readonly onShare: (url: string) => void;
  readonly onShareQr: (uri: string) => void;
  readonly onSelectFormat: (candidate: ProfileShareUrlCandidate) => void;
  readonly onRetryQr: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { selected } = state;
  const otherCandidates = state.candidates.filter((candidate) => candidate.kind !== selected.kind);
  const qrBlockedBySize = profileShareQrIsOversize(selected, state.model);
  const visibleQrState: ProfileShareQrState = qrBlockedBySize
    ? { kind: 'oversize', url: selected.url }
    : qrState;
  const qrImageUri =
    !qrBlockedBySize && qrState.kind === 'ready' && qrState.url === selected.url
      ? qrState.uri
      : null;

  return (
    <>
      <CopyableUrlPill candidate={selected} onCopy={onCopy} />

      <QrPreview url={selected.url} state={visibleQrState} onRetry={onRetryQr} />

      <View className="flex-row gap-2">
        <View style={{ flex: 1 }}>
          <ThemedButton
            label={t('meShare.copyLink')}
            variant="primary"
            fullWidth
            haptic={false}
            leadingIcon={<SfIcon name="doc.on.doc" size={15} color={Colors.pageBg} />}
            onPress={() => {
              onCopy(selected.url);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedButton
            label={t('meShare.shareLink')}
            variant="secondary"
            fullWidth
            leadingIcon={<SfIcon name="square.and.arrow.up" size={15} color={Colors.text1} />}
            onPress={() => {
              onShare(selected.url);
            }}
          />
        </View>
      </View>

      <ThemedButton
        label={t('meShare.shareQrImage')}
        variant="secondary"
        fullWidth
        disabled={qrImageUri === null}
        leadingIcon={<SfIcon name="photo" size={15} color={Colors.text1} />}
        onPress={() => {
          if (qrImageUri !== null) onShareQr(qrImageUri);
        }}
      />

      <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
        {t('meShare.bioHint')}
      </ThemedText>

      <OtherFormatsSection
        visible={visible}
        candidates={otherCandidates}
        verifiedHandle={state.verifiedHandle}
        onSelect={onSelectFormat}
      />
    </>
  );
}

function CopyableUrlPill({
  candidate,
  onCopy,
}: {
  readonly candidate: ProfileShareUrlCandidate;
  readonly onCopy: (url: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const displayUrl = displayProfileShareUrl(candidate);
  return (
    <PressableScale
      haptic={false}
      onPress={() => {
        onCopy(candidate.url);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${t('meShare.pageUrl')}: ${displayUrl}`}
      accessibilityHint={t('meShare.copyUrlHint')}>
      <ThemedSurface
        variant="inset"
        className="flex-row items-center gap-3 px-4 py-3"
        style={{ minHeight: 72 }}>
        <View className="flex-1 gap-1">
          <ThemedText variant="label" tone="secondary">
            {t('meShare.pageUrl')}
          </ThemedText>
          <ThemedText variant="bodyMedium" numberOfLines={2} ellipsizeMode="middle">
            {displayUrl}
          </ThemedText>
        </View>
        <SfIcon name="doc.on.doc" size={18} color={Colors.text1} />
      </ThemedSurface>
    </PressableScale>
  );
}

function QrPreview({
  url,
  state,
  onRetry,
}: {
  readonly url: string;
  readonly state: ProfileShareQrState;
  readonly onRetry: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const matchesUrl = state.url === url;
  return (
    <ThemedSurface
      variant="card"
      className="self-center rounded-none p-2"
      style={{
        width: PROFILE_SHARE_QR_SIZE + 16,
        height: PROFILE_SHARE_QR_SIZE + 16,
      }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {matchesUrl && state.kind === 'ready' ? (
          <Image
            source={{ uri: state.uri }}
            contentFit="contain"
            accessibilityLabel={t('meShare.qrAccessibility')}
            style={{ width: PROFILE_SHARE_QR_SIZE, height: PROFILE_SHARE_QR_SIZE }}
          />
        ) : matchesUrl && state.kind === 'error' ? (
          <View className="items-center gap-3 px-4">
            <ThemedText variant="bodySmall" tone="error" style={{ textAlign: 'center' }}>
              {t('meShare.qrError')}
            </ThemedText>
            <ThemedButton label={t('meShare.retry')} variant="secondary" onPress={onRetry} />
          </View>
        ) : matchesUrl && state.kind === 'oversize' ? (
          <View className="items-center gap-3 px-4">
            <SfIcon name="exclamationmark.triangle" size={22} color={Colors.destructive} />
            <ThemedText variant="bodySmall" tone="error" style={{ textAlign: 'center' }}>
              {t('meShare.qrTooLarge')}
            </ThemedText>
          </View>
        ) : (
          <View className="items-center gap-2">
            <ActivityIndicator size="small" color={Colors.text3} />
            <ThemedText variant="caption" tone="tertiary">
              {t('profileCard.generatingQr')}
            </ThemedText>
          </View>
        )}
      </View>
    </ThemedSurface>
  );
}

function OtherFormatsSection({
  visible,
  candidates,
  verifiedHandle,
  onSelect,
}: {
  readonly visible: boolean;
  readonly candidates: readonly ProfileShareUrlCandidate[];
  readonly verifiedHandle: HandleShareCandidate | null;
  readonly onSelect: (candidate: ProfileShareUrlCandidate) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  if (candidates.length === 0) return null;

  return (
    <View className="gap-2">
      <PressableScale
        haptic="tap"
        onPress={() => {
          setExpanded((value) => !value);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('meShare.otherFormats')}
        accessibilityState={{ expanded }}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 4,
        }}>
        <SfIcon name="link" size={14} color={Colors.text2} />
        <ThemedText variant="bodySmall" tone="secondary" className="flex-1">
          {t('meShare.otherFormats')}
        </ThemedText>
        <SfIcon name={expanded ? 'chevron.up' : 'chevron.down'} size={12} color={Colors.text3} />
      </PressableScale>

      {expanded ? (
        <View className="gap-2">
          {candidates.map((candidate) => (
            <OtherFormatRow
              key={`${candidate.kind}:${candidate.url}`}
              candidate={candidate}
              verifiedHandle={verifiedHandle}
              onSelect={onSelect}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function OtherFormatRow({
  candidate,
  verifiedHandle,
  onSelect,
}: {
  readonly candidate: ProfileShareUrlCandidate;
  readonly verifiedHandle: HandleShareCandidate | null;
  readonly onSelect: (candidate: ProfileShareUrlCandidate) => void;
}): ReactNode {
  const { t } = useTranslation();
  const label =
    candidate.kind === 'username'
      ? t('meShare.usernameFormat')
      : candidate.kind === 'handle'
      ? verifiedHandle?.url === candidate.url
        ? `@${verifiedHandle.handle}`
        : t('meShare.verifiedHandleFormat')
      : candidate.kind === 'short'
        ? t('meShare.shortFormat')
        : t('meShare.offlineFormat');

  return (
    <ThemedSurface variant="inset" className="flex-row items-center gap-3 rounded-none px-3 py-2">
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodySmall">{label}</ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1} ellipsizeMode="middle">
          {displayProfileShareUrl(candidate)}
        </ThemedText>
      </View>
      <ThemedButton
        label={t('meShare.use')}
        variant="secondary"
        accessibilityLabel={t('meShare.useFormat', { format: label })}
        onPress={() => {
          onSelect(candidate);
        }}
      />
    </ThemedSurface>
  );
}
