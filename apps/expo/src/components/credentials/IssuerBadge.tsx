/**
 * IssuerBadge — small "[logo] Issuer Name • verified" chip rendered above
 * the credential hero (CredentialDetailView) and inline with each row in
 * the VC list. Mirrors the issuer attribution Swift draws on top of
 * `solidarity/Views/MeViews/CredentialDetailView.swift` and the meta-row
 * in the Me-tab credential list.
 *
 * Render rules:
 *   - Logo bytes come from `issuerStore.getIssuer(id).logoBase64` (sync
 *     after hydrate). If missing, render a placeholder showing the first
 *     letter of `displayName` — never a fake logo (Rule 8).
 *   - Verified checkmark uses `Colors.accentRose`; issuer name uses
 *     `Colors.text2` per Rule 4.
 *   - 44 × 44 minimum touch target when `onPress` is provided.
 */
import { Image, View } from 'react-native';
import { useMemo, type ReactNode } from 'react';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  useIssuerMetadataStore,
  type IssuerMetadata,
} from '@/credentials/issuerStore';
import { trustsIssuer } from '@/credentials/trustAnchor';

const LOGO_SIZE = 18;
const TOUCH_TARGET = 44;

export interface IssuerBadgeProps {
  /** Issuer DID or canonical URL — same key used by `getIssuer`. */
  readonly issuerId: string;
  /** Fallback display name shown when metadata hasn't been cached yet. */
  readonly fallbackName?: string;
  /** Tap handler; when present, the badge becomes a 44×44 touch target. */
  readonly onPress?: () => void;
  /** Compact mode: omit verified chip and use a smaller logo (list rows). */
  readonly compact?: boolean;
}

export function IssuerBadge({
  issuerId,
  fallbackName,
  onPress,
  compact = false,
}: IssuerBadgeProps): ReactNode {
  const entries = useIssuerMetadataStore((s) => s.entries);
  const metadata = useMemo<IssuerMetadata | undefined>(
    () => entries[issuerId.trim()],
    [entries, issuerId]
  );
  const verified = useMemo(() => trustsIssuer(issuerId), [issuerId]);

  const displayName = metadata?.displayName ?? fallbackName ?? shortenIssuer(issuerId);
  const logoUri = metadata?.logoBase64
    ? `data:${metadata.logoMimeType ?? 'image/png'};base64,${metadata.logoBase64}`
    : undefined;

  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <LogoOrPlaceholder logoUri={logoUri} displayName={displayName} compact={compact} />
      <ThemedText
        variant={compact ? 'bodySmall' : 'bodyMedium'}
        tone="secondary"
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {displayName}
      </ThemedText>
      {verified && !compact ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <SfIcon name="checkmark.seal.fill" size={12} color={Colors.accentRose} />
          <ThemedText variant="caption" tone="accent">
            verified
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Issuer ${displayName}`}
      style={{
        minHeight: TOUCH_TARGET,
        justifyContent: 'center',
      }}
    >
      {body}
    </PressableScale>
  );
}

interface LogoOrPlaceholderProps {
  readonly logoUri: string | undefined;
  readonly displayName: string;
  readonly compact: boolean;
}

function LogoOrPlaceholder({
  logoUri,
  displayName,
  compact,
}: LogoOrPlaceholderProps): ReactNode {
  const size = compact ? LOGO_SIZE : LOGO_SIZE + 4;
  if (logoUri) {
    return (
      <Image
        source={{ uri: logoUri }}
        accessibilityIgnoresInvertColors
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.warmCream,
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      />
    );
  }
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: Colors.warmCream,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ThemedText
        variant="caption"
        tone="primary"
        style={{ fontSize: size - 8 }}
      >
        {initial}
      </ThemedText>
    </View>
  );
}

function shortenIssuer(id: string): string {
  if (id.startsWith('did:')) {
    const segments = id.split(':');
    if (segments.length >= 3) {
      const tail = segments.slice(2).join(':');
      return tail.length > 14 ? `${tail.slice(0, 6)}…${tail.slice(-4)}` : tail;
    }
  }
  try {
    return new URL(id).hostname;
  } catch {
    return id;
  }
}
