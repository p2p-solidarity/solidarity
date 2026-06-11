import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PresentationChunkPlaybackControls } from '@/components/me/PresentationChunkPlaybackControls';
import { ThemedText } from '@/components/themed/ThemedText';
import { Colors } from '@/constants/Colors';
import {
  credentialTrustDisplayFor,
  type TrustDisplayTone,
} from '@/credentials/trustDisplay';
import type { ProvableClaimEntity } from '@/identity/entities';
import type { PresentationQRPage } from '@/me/presentationQrPages';

const AUTO_ADVANCE_MS = 1200;

export interface PresentationProofQrProps {
  readonly credentialTitle?: string;
  readonly selectedClaims: readonly ProvableClaimEntity[];
  readonly pages: readonly PresentationQRPage[];
  readonly showTitle?: boolean;
  readonly emptyText?: string;
  readonly footerText?: string | null;
  readonly qrSize?: number;
}

export function PresentationProofQr({
  credentialTitle,
  selectedClaims,
  pages,
  showTitle = false,
  emptyText = 'No claims to present.',
  footerText = 'Present this QR to a verifier.\nOnly selected disclosures are included.',
  qrSize = 260,
}: PresentationProofQrProps): ReactNode {
  const pagesKey = useMemo(
    () => pages.map((page) => page.payload).join('|'),
    [pages],
  );
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(pages.length > 1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setIndex(0);
    setIsPlaying(pages.length > 1);
  }, [pages.length, pagesKey]);

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
    <View style={{ alignItems: 'center', gap: 18 }}>
      {showTitle ? (
        <View style={{ alignItems: 'center', gap: 6 }}>
          {credentialTitle ? (
            <ThemedText
              variant="bodyLarge"
              style={{ fontWeight: '700', textAlign: 'center' }}
            >
              {credentialTitle}
            </ThemedText>
          ) : null}
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
      ) : null}

      {selectedClaims.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          {selectedClaims.map((claim) => (
            <ClaimChip key={claim.id} claim={claim} />
          ))}
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
              size={qrSize}
              backgroundColor="#FFFFFF"
              color="#000000"
            />
          </View>
        ) : (
          <ThemedText tone="tertiary">{emptyText}</ThemedText>
        )}

        {pages.length > 1 ? (
          <PresentationChunkPlaybackControls
            currentIndex={index}
            totalChunks={pages.length}
            isPlaying={isPlaying}
            onPrev={() => {
              setIndex((i) => Math.max(0, i - 1));
              setIsPlaying(false);
            }}
            onNext={() => {
              setIndex((i) => Math.min(pages.length - 1, i + 1));
              setIsPlaying(false);
            }}
            onTogglePlay={() => {
              setIsPlaying((p) => !p);
            }}
          />
        ) : null}
      </View>

      {footerText ? (
        <ThemedText
          variant="caption"
          tone="secondary"
          style={{ textAlign: 'center', paddingHorizontal: 32 }}
        >
          {footerText}
        </ThemedText>
      ) : null}
    </View>
  );
}

function ClaimChip({ claim }: { readonly claim: ProvableClaimEntity }): ReactNode {
  const trustDisplay = credentialTrustDisplayFor({
    source: claim.source,
    trustLevel: claim.trustLevel,
    payload: claim.payload,
  });
  const accent = levelAccent(trustDisplay.tone);
  return (
    <View
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
          {trustDisplay.level}
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
}

function levelAccent(tone: TrustDisplayTone): string {
  switch (tone) {
    case 'green':
      return Colors.terminalGreen;
    case 'blue':
      return Colors.primaryBlue;
    default:
      return Colors.text3;
  }
}
