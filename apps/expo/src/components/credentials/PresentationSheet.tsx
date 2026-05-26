import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { PresentationChunkPlaybackControls } from '@/components/me/PresentationChunkPlaybackControls';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import { useIdentityData, type ProvableClaimEntity } from '@/identity';
import type { TrustLevel } from '@/identity/entities';
import { buildPresentationQrPages } from '@/me/presentationQrPages';

// Local helper: matches `levelAccent` in app/credentials/[id].tsx
// (L3 → terminalGreen, L2 → primaryBlue, L1 → text3). Kept local — not exported.
function levelAccent(trustLevel: TrustLevel): string {
  switch (trustLevel) {
    case 'L3':
      return Colors.terminalGreen;
    case 'L2':
      return Colors.primaryBlue;
    default:
      return Colors.text3;
  }
}

const AUTO_ADVANCE_MS = 1200;

export interface PresentationSheetProps {
  readonly visible: boolean;
  readonly credentialId: string;
  readonly credentialTitle: string;
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
}

export function PresentationSheet({
  visible,
  credentialId,
  credentialTitle,
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
        credentialTitle={credentialTitle}
        selectedClaimIds={selectedClaimIds}
        onDismiss={onDismiss}
      />
    </Modal>
  );
}

function PresentationBody({
  credentialId,
  credentialTitle,
  selectedClaimIds,
  onDismiss,
}: {
  readonly credentialId: string;
  readonly credentialTitle: string;
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly onDismiss: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const provableClaims = useIdentityData((s) => s.provableClaims);

  const selectedClaims: readonly ProvableClaimEntity[] = useMemo(
    () =>
      provableClaims.filter(
        (c) =>
          c.identityCardId === credentialId &&
          (selectedClaimIds.size === 0 || selectedClaimIds.has(c.id)),
      ),
    [provableClaims, credentialId, selectedClaimIds],
  );

  const pages = useMemo(() => {
    if (selectedClaims.length === 0) return [];
    const vp = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: selectedClaims.map((c) => c.payload),
      nonce: cryptoNonce(),
      claim_types: selectedClaims.map((c) => c.claimType),
    };
    return buildPresentationQrPages(JSON.stringify(vp));
  }, [selectedClaims]);

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

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: insets.bottom + 24,
          gap: 24,
        }}
      >
        <View style={{ alignItems: 'center', gap: 6 }}>
          <ThemedText
            variant="bodyLarge"
            style={{ fontWeight: '700', textAlign: 'center' }}
          >
            {credentialTitle}
          </ThemedText>
          <ThemedText
            variant="caption"
            style={{
              color: Colors.terminalGreen,
              fontWeight: '500',
              textAlign: 'center',
            }}
          >
            {`${selectedClaims.length} claim(s) selected`}
          </ThemedText>
        </View>

        {selectedClaims.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'center',
            }}
          >
            {selectedClaims.map((claim) => {
              const accent = levelAccent(claim.trustLevel);
              return (
                <View
                  key={claim.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 8,
                    paddingVertical: 5,
                    borderRadius: 4,
                    backgroundColor: Colors.chipSurface,
                    borderWidth: 1,
                    borderColor: accent,
                  }}
                >
                  <View
                    style={{
                      borderWidth: 0.5,
                      borderColor: accent,
                      borderRadius: 2,
                      paddingHorizontal: 4,
                      paddingVertical: 1,
                    }}
                  >
                    <ThemedText
                      variant="caption"
                      style={{ color: accent, fontSize: 9, fontWeight: '600' }}
                    >
                      {claim.trustLevel}
                    </ThemedText>
                  </View>
                  <ThemedText
                    variant="caption"
                    style={{ fontWeight: '500', fontSize: 10 }}
                  >
                    {claim.claimType}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={{ alignItems: 'center', gap: 14 }}>
          {current ? (
            <View
              style={{
                backgroundColor: '#FFFFFF',
                padding: 16,
                borderRadius: 12,
              }}
            >
              <QRCode
                value={current.payload}
                size={260}
                backgroundColor="#FFFFFF"
                color="#000000"
              />
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

        <ThemedText
          variant="caption"
          tone="secondary"
          style={{ textAlign: 'center', paddingHorizontal: 32 }}
        >
          {'Present this QR to a verifier.\nOnly selected disclosures are included.'}
        </ThemedText>
      </ScrollView>
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
