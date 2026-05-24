import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { PresentationChunkPlaybackControls } from '@/components/me/PresentationChunkPlaybackControls';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import { useIdentityData } from '@/identity';
import { buildPresentationQrPages } from '@/me/presentationQrPages';

const AUTO_ADVANCE_MS = 1200;

export interface PresentationSheetProps {
  readonly visible: boolean;
  readonly credentialId: string;
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
}

export function PresentationSheet({
  visible,
  credentialId,
  selectedClaimIds,
  onDismiss,
}: PresentationSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <PresentationBody
        credentialId={credentialId}
        selectedClaimIds={selectedClaimIds}
        onDismiss={onDismiss}
      />
    </Modal>
  );
}

function PresentationBody({
  credentialId,
  selectedClaimIds,
  onDismiss,
}: {
  readonly credentialId: string;
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const provableClaims = useIdentityData((s) => s.provableClaims);

  const pages = useMemo(() => {
    const claims = provableClaims.filter(
      (c) =>
        c.identityCardId === credentialId &&
        (selectedClaimIds.size === 0 || selectedClaimIds.has(c.id)),
    );
    if (claims.length === 0) return [];
    const vp = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: claims.map((c) => c.payload),
      nonce: cryptoNonce(),
      claim_types: claims.map((c) => c.claimType),
    };
    return buildPresentationQrPages(JSON.stringify(vp));
  }, [provableClaims, credentialId, selectedClaimIds]);

  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(pages.length > 1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setIndex(0);
    setIsPlaying(pages.length > 1);
  }, [pages.length]);

  useEffect(() => {
    if (!isPlaying || pages.length <= 1) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % pages.length);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [isPlaying, pages.length]);

  const current = pages[index];

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View
        className="flex-row items-center justify-between px-4"
        style={{ height: 44 }}
      >
        <View style={{ width: 44 }} />
        <ThemedText variant="bodyMedium" style={{ fontWeight: '600' }}>
          Present
        </ThemedText>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          className="active:opacity-60"
        >
          <SfIcon name="xmark" size={16} weight="semibold" color={Colors.text1} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-4 gap-6">
        {current ? (
          <View
            style={{
              backgroundColor: '#FFFFFF',
              padding: 16,
              borderRadius: 12,
            }}
          >
            <QRCode value={current.payload} size={260} backgroundColor="#FFFFFF" />
          </View>
        ) : (
          <ThemedText tone="tertiary">No claims to present.</ThemedText>
        )}

        {pages.length > 1 ? (
          <PresentationChunkPlaybackControls
            currentIndex={index}
            totalChunks={pages.length}
            isPlaying={isPlaying}
            onPrev={() => { setIndex((i) => Math.max(0, i - 1)); setIsPlaying(false); }}
            onNext={() => { setIndex((i) => Math.min(pages.length - 1, i + 1)); setIsPlaying(false); }}
            onTogglePlay={() => { setIsPlaying((p) => !p); }}
          />
        ) : null}
      </View>

      <View style={{ height: insets.bottom + 12 }} />
    </View>
  );
}

function cryptoNonce(): string {
  const arr = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
